import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '../../App';
import { ADMIN } from '../../test/utils';
import { mockStore } from '../../mocks/adapters';
import { SAME_PHONE_NOTE, SELF_FILLED_NOTE } from '../../mocks/intake';
import { session } from '../../api/client';
import { IntakeSection } from '../Admin/IntakeAdmin';
import Register from './Register';

function renderRegister(user = null) {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <AppProviders initialUser={user}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/queue/*" element={<div>queue screen</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

const newest = () => mockStore.state.patients[mockStore.state.patients.length - 1];

beforeEach(() => {
  mockStore.reset();
  localStorage.clear();
  window.scrollTo = vi.fn(); // jsdom has no scrolling
});

describe('New patient form, filled by the patient (public)', () => {
  it('in English: creates the patient in the first stage and shows the token', async () => {
    renderRegister();
    await userEvent.click(screen.getByTestId('reg-lang-en'));
    expect(screen.getByRole('heading', { name: 'New patient form' })).toBeInTheDocument();
    expect(screen.getByText(/Been here before\? Please tell the reception desk instead\./)).toBeInTheDocument();
    await screen.findByTestId('reg-cond-Diabetes');
    const before = mockStore.state.patients.length;

    await userEvent.type(screen.getByLabelText(/Your full name/), 'Kokila Desai');
    await userEvent.type(screen.getByLabelText(/Mobile number/), '7000011111');
    await userEvent.type(screen.getByLabelText(/Age, if date of birth not known/), '58');
    await userEvent.click(screen.getByTestId('reg-sex-F'));
    await userEvent.type(screen.getByLabelText('Address'), 'Vesu, Surat');
    await userEvent.click(screen.getByTestId('reg-cond-Diabetes'));
    await userEvent.click(screen.getByTestId('reg-pref-lang-gujarati'));
    await userEvent.click(screen.getByTestId('reg-ref-doctor'));
    await userEvent.type(screen.getByLabelText('Name of the doctor who sent you'), 'Dr. Shah');
    await userEvent.click(screen.getByTestId('reg-elsewhere-true'));
    await userEvent.type(screen.getByLabelText(/Where, and for what\?/), 'Cataract op, Rajkot');
    await userEvent.click(screen.getByRole('button', { name: 'Send my details' }));

    const thanks = await screen.findByTestId('reg-thanks');
    expect(thanks).toHaveTextContent('Thank you, Kokila');
    expect(thanks).toHaveTextContent('Please show this number at the reception desk.');
    const p = newest();
    expect(mockStore.state.patients.length).toBe(before + 1);
    expect(within(thanks).getByTestId('reg-token')).toHaveTextContent(p.token);
    expect(p).toMatchObject({
      name: 'Kokila Desai',
      phone: '7000011111',
      age: 58,
      sex: 'F',
      address: 'Vesu, Surat',
      language: 'gujarati',
      referralSource: 'doctor',
      referralDetail: 'Dr. Shah',
      elsewhere: true,
      elsewhereNote: 'Cataract op, Rajkot',
      existingConditions: ['Diabetes'],
      stage: mockStore.state.stages[0].key,
      note: SELF_FILLED_NOTE,
    });

    // Families come together: the next person starts from an empty form.
    await userEvent.click(screen.getByRole('button', { name: 'Fill for another person' }));
    expect(screen.getByLabelText(/Your full name/)).toHaveValue('');
    expect(screen.getByLabelText(/Mobile number/)).toHaveValue('');
  });

  it('in Gujarati (the default for patients): wording, errors and the thank-you screen', async () => {
    renderRegister();
    expect(screen.getByRole('heading', { name: 'નવા દર્દી માટેનું ફોર્મ' })).toBeInTheDocument();
    expect(await screen.findByText('ડાયાબિટીસ (સુગર)')).toBeInTheDocument(); // admin list, shown in Gujarati
    expect(screen.queryByText('Diabetes')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/તમારું પૂરું નામ/), 'રમેશ પટેલ');
    await userEvent.click(screen.getByRole('button', { name: 'મારી વિગતો મોકલો' }));
    expect(await screen.findByText(/10 આંકડાનો mobile number લખશો\?/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/મોબાઇલ નંબર/), '98240 89012'); // same phone as Pooja Trivedi
    await userEvent.click(screen.getByTestId('reg-sex-M'));
    await userEvent.click(screen.getByRole('button', { name: 'મારી વિગતો મોકલો' }));
    const thanks = await screen.findByTestId('reg-thanks');
    expect(thanks).toHaveTextContent('આભાર, રમેશ');
    expect(thanks).toHaveTextContent('કૃપા કરીને આ નંબર રિસેપ્શન પર બતાવો.');
    // Nothing on the page says the number was known; reception gets the flag in the note.
    expect(screen.queryByText(/Pooja/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('same-phone')).not.toBeInTheDocument();
    expect(newest().note).toBe(`${SELF_FILLED_NOTE} ${SAME_PHONE_NOTE}`);
    expect(screen.getByRole('button', { name: 'બીજી વ્યક્તિ માટે ફોર્મ ભરો' })).toBeInTheDocument();
  });

  it('shows the reception message when the server says too many forms came from this phone', async () => {
    const { intake } = await import('../../mocks/adapters');
    const spy = vi.spyOn(intake, 'submit').mockRejectedValueOnce({ response: { status: 429, data: {} } });
    renderRegister();
    await userEvent.click(screen.getByTestId('reg-lang-en'));
    await userEvent.type(screen.getByLabelText(/Your full name/), 'Test Person');
    await userEvent.type(screen.getByLabelText(/Mobile number/), '7000099999');
    await userEvent.click(screen.getByRole('button', { name: 'Send my details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many forms from this phone');
    spy.mockRestore();
  });
});

describe('New patient form, filled by staff at the desk', () => {
  it('offers the duplicate prompt for a known phone, then "Use this patient" queues them', async () => {
    renderRegister(ADMIN);
    expect(screen.getByTestId('reg-staff-bar')).toHaveTextContent('Staff entry');
    expect(screen.getByRole('heading', { name: 'New patient form' })).toBeInTheDocument(); // staff start in English

    await userEvent.type(screen.getByLabelText(/Mobile number/), '+91 98240-89012');
    const panel = await screen.findByTestId('same-phone');
    expect(panel).toHaveTextContent('Already registered with this number');
    const row = within(panel).getByTestId('same-phone-9');
    expect(row).toHaveTextContent('Pooja Trivedi');

    const before = mockStore.state.patients.length;
    await userEvent.click(within(row).getByRole('button', { name: 'Use this patient' }));
    expect(await screen.findByTestId('reg-last')).toHaveTextContent('Pooja Trivedi added to the queue');
    expect(mockStore.state.patients.length).toBe(before); // no new record
    expect(screen.getByLabelText(/Mobile number/)).toHaveValue(''); // ready for the next person
  });

  it('adds a new patient and goes straight back to an empty form', async () => {
    session.set('mock-token-admin', ADMIN);
    renderRegister(ADMIN);
    await screen.findByTestId('reg-cond-Asthma');
    await userEvent.type(screen.getByLabelText(/Your full name/), 'Bhanuben Shah');
    await userEvent.click(screen.getByTestId('reg-cond-Asthma'));
    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    expect(await screen.findByTestId('reg-last')).toHaveTextContent('Bhanuben Shah added to the queue');
    expect(screen.queryByTestId('reg-thanks')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Your full name/)).toHaveValue('');
    expect(newest()).toMatchObject({ name: 'Bhanuben Shah', existingConditions: ['Asthma'], note: '' });
  });
});

describe('Admin QR poster', () => {
  it('shows the link and a poster with the QR code in three languages, and prints it', async () => {
    window.print = vi.fn();
    render(
      <MemoryRouter>
        <AppProviders initialUser={ADMIN}>
          <IntakeSection />
        </AppProviders>
      </MemoryRouter>
    );
    const url = `${window.location.origin}/register`;
    expect(screen.getByTestId('intake-url')).toHaveTextContent(url);
    const poster = screen.getByTestId('intake-poster');
    expect(within(poster).getByTestId('qr-code')).toHaveAttribute('data-text', url);
    expect(within(poster).getByTestId('qr-code').querySelector('path').getAttribute('d').length).toBeGreaterThan(100);
    expect(poster).toHaveTextContent('New patient? Scan to fill your details');
    expect(poster).toHaveTextContent('નવા દર્દી છો? તમારી વિગતો ભરવા માટે scan કરો');
    expect(poster).toHaveTextContent('नए मरीज़ हैं? अपनी जानकारी भरने के लिए scan करें');
    expect(within(poster).getByRole('img', { name: /Guru Krupa/ })).toHaveAttribute('src', '/logo.png');

    await userEvent.click(screen.getByRole('button', { name: 'A5' }));
    expect(screen.getByTestId('intake-poster')).toHaveClass('poster-a5');
    await userEvent.click(screen.getByRole('button', { name: 'Print poster' }));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });
});
