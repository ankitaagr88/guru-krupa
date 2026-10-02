"""Spreadsheet import (B13): inspect, preview (dry run) and run for each target."""
import io

import pytest

from app.seed.reference import seed_reference

PATIENTS_CSV = """#,Name,Contact,Gender,Age(Y),Local Id,Area,City,Appointment
1,A N TIWARI,9727898614,Male,71,GK2341,-,Surat,03-01-2024
2,AAGU DEVI,9799334819,Female,81,GK3786,VESU,Surat,12-01-2026
3,,9999999999,Male,30,GK9999,,Surat,
4,A N TIWARI,9727898614,Male,72,GK2341,VESU,Surat,05-05-2025
"""

MEDS_CSV = "Medicine Name,Company\nMoxicip Eye Drops,Cipla\nAquaray Gel,Sun\n,Nobody\nmoxicip eye drops,Cipla\n"

STOCK_CSV = """Item,Qty,Unit
Ketorolac 0.5% eye drops,9,bottles
New Import Drops,3,
Bad One,lots,
"""

RX_CSV = """Local Id,Patient Name,Date,Diagnosis,Medicine,Dosage
GK2341,A N TIWARI,14-09-2025,Dry Eye,Aquaray Gel,at night
GK2341,A N TIWARI,14-09-2025,Dry Eye,Moxicip Eye Drops,1 drop 4x daily
GK3786,AAGU DEVI,2025-09-15,Dry Eye,Aquaray Gel,at night
GK0000,Nobody Here,2025-09-15,Dry Eye,Aquaray Gel,at night
GK3786,AAGU DEVI,not a date,Dry Eye,Aquaray Gel,at night
"""


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from sqlalchemy import delete, select

    from app.db import SessionLocal
    from app.models import (InventoryItem, Medicine, Patient, Prescription, PrescriptionLine, StockMovement,
                            Visit)

    with SessionLocal() as db:
        seed_reference(db)
    yield
    # Leave the shared test database as the other modules expect it.
    with SessionLocal() as db:
        imported = list(db.scalars(select(Patient).where(Patient.external_id.is_not(None))))
        for p in imported:
            for v in db.scalars(select(Visit).where(Visit.patient_id == p.id)):
                for rx in db.scalars(select(Prescription).where(Prescription.visit_id == v.id)):
                    db.execute(delete(PrescriptionLine).where(PrescriptionLine.prescription_id == rx.id))
                    db.delete(rx)
                db.delete(v)
            db.delete(p)
        for name in ("New Import Drops",):
            for it in db.scalars(select(InventoryItem).where(InventoryItem.name == name)):
                db.execute(delete(StockMovement).where(StockMovement.item_id == it.id))
                db.delete(it)
        ket = db.scalar(select(InventoryItem).where(InventoryItem.name == "Ketorolac 0.5% eye drops"))
        if ket is not None:
            db.execute(delete(StockMovement).where(StockMovement.item_id == ket.id, StockMovement.reason == "adjusted"))
            ket.stock = 7
        for name in ("Moxicip Eye Drops", "LUBREX DS"):
            for m in db.scalars(select(Medicine).where(Medicine.name == name)):
                db.delete(m)
        db.commit()


def _upload(client, headers, name, text):
    r = client.post("/api/admin/import/files", files={"file": (name, io.BytesIO(text.encode()), "text/csv")},
                    headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_targets_and_inspect(client, admin_headers):
    t = client.get("/api/admin/import/targets", headers=admin_headers).json()
    assert [x["key"] for x in t] == ["patients", "medicines", "stock", "prescriptions", "visits", "payments"]
    up = _upload(client, admin_headers, "patients.csv", PATIENTS_CSV)
    assert up["headers"][1] == "Name" and up["rowCount"] == 4 and len(up["sample"]) == 4
    s = up["suggested"]["patients"]
    assert s == {"external_id": "Local Id", "name": "Name", "phone": "Contact", "sex": "Gender", "age": "Age(Y)",
                 "area": "Area", "city": "City"}


def test_patients_preview_then_run(client, admin_headers):
    up = _upload(client, admin_headers, "patients.csv", PATIENTS_CSV)
    body = {"token": up["token"], "target": "patients", "mapping": up["suggested"]["patients"]}
    # missing required column -> 422
    bad = client.post("/api/admin/import/preview", json={**body, "mapping": {"phone": "Contact"}}, headers=admin_headers)
    assert bad.status_code == 422 and "Name" in bad.json()["detail"]

    p = client.post("/api/admin/import/preview", json=body, headers=admin_headers).json()
    assert p["written"] is False and p["total"] == 4
    assert (p["new"], p["update"], p["skip"]) == (2, 0, 2)
    actions = {r["row"]: (r["action"], r["reason"]) for r in p["rows"]}
    assert actions[3] == ("skip", "no name")
    assert "twice" in actions[4][1]
    # nothing written by a preview
    assert client.get("/api/patients", params={"q": "TIWARI"}, headers=admin_headers).json() == []

    r = client.post("/api/admin/import/run", json=body, headers=admin_headers).json()
    assert r["written"] and r["new"] == 2
    got = client.get("/api/patients", params={"q": "TIWARI"}, headers=admin_headers).json()
    assert len(got) == 1
    t = got[0]
    assert t["externalId"] == "GK2341" and t["phone"] == "9727898614" and t["sex"] == "M" and t["age"] == 71
    assert t["address"] == "Surat"  # "-" area dropped

    # re-run: everything already here -> skipped, no duplicates
    r2 = client.post("/api/admin/import/run", json=body, headers=admin_headers).json()
    assert r2["new"] == 0 and r2["skip"] >= 2
    assert len(client.get("/api/patients", params={"q": "TIWARI"}, headers=admin_headers).json()) == 1


def test_dob_parsing():
    from datetime import date

    from app.services.imports import _dob

    on = date(2026, 9, 23)
    assert _dob("12/03/1964", on) == date(1964, 3, 12)
    assert _dob("12-03-1964", on) == date(1964, 3, 12)
    assert _dob("5/3/64", on) == date(1964, 3, 5)  # two-digit year: last century, not 2064
    assert _dob("5/3/20", on) == date(2020, 3, 5)
    assert _dob("1964-03-12", on) == date(1964, 3, 12)
    assert _dob("23448", on) == date(1964, 3, 12)  # Excel serial number
    assert _dob("", on) is None and _dob("unknown", on) is None
    assert _dob("01/01/2030", on) is None  # in the future
    assert _dob("01/01/1850", on) is None  # more than 120 years ago


DOB_CSV = """Name,Contact,Gender,Age(Y),D.O.B,Local Id
DOB PERSON ONE,9812300001,Female,40,12/03/1964,GKD001
DOB PERSON TWO,9812300002,Male,55,,GKD002
DOB PERSON THREE,9812300003,Male,33,not known,GKD003
"""


def test_patients_import_keeps_dob_else_age(client, admin_headers):
    from datetime import date

    up = _upload(client, admin_headers, "dob.csv", DOB_CSV)
    m = up["suggested"]["patients"]
    assert m["dob"] == "D.O.B" and m["age"] == "Age(Y)"
    r = client.post("/api/admin/import/run", json={"token": up["token"], "target": "patients", "mapping": m},
                    headers=admin_headers).json()
    assert r["new"] == 3
    got = {p["externalId"]: p for p in client.get("/api/patients", params={"q": "DOB PERSON"},
                                                   headers=admin_headers).json()}
    today = date.today()
    assert got["GKD001"]["dob"] == "1964-03-12"
    assert got["GKD001"]["age"] == today.year - 1964 - ((today.month, today.day) < (3, 12))  # from DOB, not 40
    assert got["GKD002"]["dob"] is None and got["GKD002"]["age"] == 55  # no DOB: Age(Y) as before
    assert got["GKD003"]["dob"] is None and got["GKD003"]["age"] == 33
    # re-run: nothing new
    r2 = client.post("/api/admin/import/run", json={"token": up["token"], "target": "patients", "mapping": m},
                     headers=admin_headers).json()
    assert r2["new"] == 0 and r2["update"] == 0 and r2["skip"] == 3


def test_medicines_and_stock(client, admin_headers):
    up = _upload(client, admin_headers, "meds.csv", MEDS_CSV)
    body = {"token": up["token"], "target": "medicines", "mapping": up["suggested"]["medicines"]}
    assert up["suggested"]["medicines"] == {"name": "Medicine Name", "manufacturer": "Company"}
    r = client.post("/api/admin/import/run", json=body, headers=admin_headers).json()
    acts = {x["row"]: x["action"] for x in r["rows"]}
    assert acts[1] == "new" and acts[2] in ("skip", "update") and acts[3] == "skip" and acts[4] == "skip"
    meds = client.get("/api/medicines", params={"q": "moxicip"}, headers=admin_headers).json()
    assert len(meds) == 1 and meds[0]["name"] == "Moxicip Eye Drops"

    up = _upload(client, admin_headers, "stock.csv", STOCK_CSV)
    m = up["suggested"]["stock"]
    assert m["name"] == "Item" and m["stock"] == "Qty" and m["unit"] == "Unit"
    r = client.post("/api/admin/import/run", json={"token": up["token"], "target": "stock", "mapping": m},
                    headers=admin_headers).json()
    acts = {x["row"]: (x["action"], x["reason"]) for x in r["rows"]}
    assert acts[1][0] == "update" and "→ 9" in acts[1][1]
    assert acts[2][0] == "new"
    assert acts[3][0] == "skip" and "not a number" in acts[3][1]
    inv = {i["name"]: i for i in client.get("/api/inventory", headers=admin_headers).json()}
    assert inv["Ketorolac 0.5% eye drops"]["stock"] == 9
    assert inv["New Import Drops"]["stock"] == 3 and inv["New Import Drops"]["unit"] == "bottles"


def test_prescriptions_group_rows_into_visits(client, admin_headers):
    up = _upload(client, admin_headers, "rx.csv", RX_CSV)
    m = up["suggested"]["prescriptions"]
    assert m["patient_external_id"] == "Local Id" and m["date"] == "Date" and m["medicine"] == "Medicine"
    body = {"token": up["token"], "target": "prescriptions", "mapping": m}
    p = client.post("/api/admin/import/preview", json=body, headers=admin_headers).json()
    acts = {x["row"]: (x["action"], x["reason"]) for x in p["rows"]}
    assert acts[1][0] == "new" and acts[2][0] == "new" and acts[3][0] == "new"
    assert acts[4][0] == "skip" and "not found" in acts[4][1]
    assert acts[5][0] == "skip" and "date" in acts[5][1]
    # a preview creates no diagnosis ("Dry eye" is seeded; the file's "Dry Eye" matches it case-insensitively)
    assert not any(d["name"] == "Uveitis import" for d in client.get("/api/diagnoses", headers=admin_headers).json())

    r = client.post("/api/admin/import/run", json=body, headers=admin_headers).json()
    assert r["written"] and r["new"] == 3 and r["skip"] == 2
    dx = next(d for d in client.get("/api/diagnoses", headers=admin_headers).json() if d["name"].lower() == "dry eye")
    assert dx["prescriptionCount"] == 2
    std = client.get(f"/api/diagnoses/{dx['id']}/standard", headers=admin_headers).json()
    assert std["source"] == "history" and std["historyCount"] == 2
    assert [l["name"] for l in std["lines"]] == ["Aquaray Gel", "Moxicip Eye Drops"]  # 100% then 50%
    assert std["lines"][0]["matched"] is True
    # the patient now has a last visit
    t = client.get("/api/patients", params={"q": "TIWARI"}, headers=admin_headers).json()[0]
    assert t["lastVisitDate"] == "2025-09-14"
    # importing the same file again writes nothing new
    r2 = client.post("/api/admin/import/run", json=body, headers=admin_headers).json()
    assert r2["new"] == 0 and r2["skip"] == 5


def test_excel_upload(client, admin_headers):
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Medicine Name", "Company"])
    ws.append(["Excel Drops", "Lupin"])
    buf = io.BytesIO()
    wb.save(buf)
    r = client.post("/api/admin/import/files",
                    files={"file": ("meds.xlsx", buf.getvalue(),
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                    headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["headers"] == ["Medicine Name", "Company"] and r.json()["sample"] == [["Excel Drops", "Lupin"]]


def test_non_admin_denied(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="imprecep", password="rec123", name="Reception", role="reception")
    tok = client.post("/api/auth/login", json={"username": "imprecep", "password": "rec123"}).json()["access_token"]
    assert client.get("/api/admin/import/targets", headers={"Authorization": f"Bearer {tok}"}).status_code == 403


# ---- KiviHealth's own export layout: one file per year, past visits and past bills
KH_PATIENTS_HEAD = ("Patient_ID,First_name,Middle_name,Last_name,Contact_number,Secondary_number,Email_address,Gender,"
                    "Address,Area_name,City_name,Pincode,DOB,Blood_group,Medical_history,Other_history,Patient_groups\n")
KH_PATIENTS_2021 = KH_PATIENTS_HEAD + (
    "GKT001,TEJAS,B,GOHIL,9638700001,,,male,\"A-203, SIDDHI RESIDENCY\",Vesu,Surat,395007,1991-01-01,,,,\n"
    "GKT002,MINABEN,,THAKKAR,7046600002,,,female,,Pal Gaam,Surat,395009,1967-05-20,,,,\n")
KH_PATIENTS_2022 = KH_PATIENTS_HEAD + (
    "GKT001,TEJAS,B,GOHIL,9638700001,,,male,\"A-203, SIDDHI RESIDENCY\",Vesu,Surat,395007,1991-01-01,,,,\n"
    "GKT003,RAVI,,SHAH,9800000003,,,male,,,Surat,,,,,,\n"
    "GKT004,Ravi,,Shah,9800000004,,,male,,,Surat,,,,,,\n")
KH_APPTS = """Appointment_ID,Patient_Number,Patient_Name,Appointment_Date,Duration,Reason,Doctor
A1,GKT001,TEJAS B GOHIL,December-29-2021,15 Minutes,TEJAS GOHIL,Dr. Anu Pathak
A2,GKT001,TEJAS B GOHIL,December-29-2021,15 Minutes,,Dr. Anu Pathak
A3,GKT003,RAVI  SHAH,January-5-2022,15 Minutes,eye pain,Dr. Anu Pathak
A4,GKT999,NOBODY,January-5-2022,15 Minutes,,Dr. Anu Pathak
"""
KH_PAYMENTS = """Patient_name,Amount,Treatment_plan,Doctor_name,Invoice_number,Receipt_number,Payment_mode,DATE
MINABEN  THAKKAR,500,Consultation,Dr.Anu Pathak,INVT1,RCPTT1,cash,December-29-2021
MINABEN  THAKKAR,220.5,LUBREX DS,Dr.Anu Pathak,INVT1,RCPTT1,cash,December-29-2021
RAVI  SHAH,500,Consultation,Dr.Anu Pathak,INVT2,RCPTT2,online,January-5-2022
Ravi  Shah,300,Follow-Up,Dr.Anu Pathak,INVT3,RCPTT3,cash,January-9-2022
TEJAS B GOHIL,20000,OPERATION CHARGES,Dr.Anu Pathak,INVT4,RCPTT4,cheque,December-29-2021
TEJAS B GOHIL,1000,MEDICINE CHARGES,Dr.Anu Pathak,INVT4,RCPTT4,cheque,December-29-2021
TEJAS B GOHIL,20000,OPERATION CHARGES,Dr.Anu Pathak,INVT4,RCPTT5,cheque,January-20-2022
TEJAS B GOHIL,1000,MEDICINE CHARGES,Dr.Anu Pathak,INVT4,RCPTT5,cheque,January-20-2022
Somebody Else,100,Consultation,Dr.Anu Pathak,INVT6,RCPTT6,cash,January-9-2022
MINABEN  THAKKAR,150,ALOE VERA EYE MASK,Dr.Anu Pathak,INVT7,RCPTT7,cash,December-29-2021
"""


def _upload_many(client, headers, named_texts):
    files = [("files", (n, io.BytesIO(t.encode()), "text/csv")) for n, t in named_texts]
    r = client.post("/api/admin/import/files", files=files, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _run(client, headers, up, target, preview=False):
    body = {"token": up["token"], "target": target, "mapping": up["suggested"][target]}
    r = client.post(f"/api/admin/import/{'preview' if preview else 'run'}", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_kivihealth_history_import(client, admin_headers):
    # Several yearly files at once, read as one; a patient in both years is imported once.
    up = _upload_many(client, admin_headers, [("2021/Patients.csv", KH_PATIENTS_2021),
                                              ("2022/Patients.csv", KH_PATIENTS_2022)])
    assert up["rowCount"] == 5 and up["filename"].startswith("2 files")
    m = up["suggested"]["patients"]
    assert (m["external_id"], m["first_name"], m["middle_name"], m["last_name"], m["phone"], m["area"], m["city"],
            m["pincode"], m["dob"]) == ("Patient_ID", "First_name", "Middle_name", "Last_name", "Contact_number",
                                        "Area_name", "City_name", "Pincode", "DOB")
    r = _run(client, admin_headers, up, "patients")
    assert r["new"] == 4 and "twice" in r["rows"][2]["reason"]
    pts = {p["externalId"]: p for p in client.get("/api/patients", params={"q": "GOHIL"}, headers=admin_headers).json()}
    tejas = pts["GKT001"]
    assert tejas["name"] == "TEJAS B GOHIL"
    assert tejas["dob"] is None and tejas["age"] is not None  # "1991-01-01" is KiviHealth's age, not a birthday
    assert tejas["address"] == "A-203, SIDDHI RESIDENCY, Vesu, Surat, 395007"
    mina = client.get("/api/patients", params={"q": "THAKKAR"}, headers=admin_headers).json()[0]
    assert mina["dob"] == "1967-05-20"  # a real birthday is kept

    # Files with different columns are refused together.
    bad = client.post("/api/admin/import/files", headers=admin_headers, files=[
        ("files", ("a.csv", io.BytesIO(KH_PATIENTS_2021.encode()), "text/csv")),
        ("files", ("b.csv", io.BytesIO(KH_APPTS.encode()), "text/csv"))])
    assert bad.status_code == 422 and "different columns" in bad.json()["detail"]

    # Past visits: two appointments the same day are one visit; the reason is kept unless it is the name.
    up = _upload(client, admin_headers, "Appointments.csv", KH_APPTS)
    m = up["suggested"]["visits"]
    assert (m["patient_external_id"], m["date"], m["reason"]) == ("Patient_Number", "Appointment_Date", "Reason")
    r = _run(client, admin_headers, up, "visits")
    acts = {x["row"]: (x["action"], x["reason"]) for x in r["rows"]}
    assert acts[1] == ("new", "") and acts[2][0] == "skip" and acts[3] == ("new", "eye pain")
    assert acts[4][0] == "skip" and "not found" in acts[4][1]
    assert _run(client, admin_headers, up, "visits")["new"] == 0  # again: nothing new

    # A medicine in the list makes its bill line a medicine line.
    meds = _upload(client, admin_headers, "meds.csv", "Medicine Name,Price\nLUBREX DS,220\n")
    assert _run(client, admin_headers, meds, "medicines")["new"] == 1
    assert client.get("/api/medicines", params={"q": "lubrex"}, headers=admin_headers).json()[0]["price"] == 220

    # Past bills, matched by name.
    up = _upload(client, admin_headers, "Payments.csv", KH_PAYMENTS)
    m = up["suggested"]["payments"]
    assert (m["patient_name"], m["item"], m["amount"], m["mode"], m["invoice"], m["receipt"], m["date"]) == (
        "Patient_name", "Treatment_plan", "Amount", "Payment_mode", "Invoice_number", "Receipt_number", "DATE")
    p = _run(client, admin_headers, up, "payments", preview=True)
    acts = {x["row"]: (x["action"], x["reason"]) for x in p["rows"]}
    assert acts[1] == ("new", "₹721 · 2 line(s)") and acts[2][0] == "skip"
    assert acts[3][0] == "new"  # two RAVI SHAHs: the one with a visit that day
    assert acts[4][0] == "skip" and "2 patients" in acts[4][1]  # no visit that day: cannot tell
    assert acts[5] == ("new", "₹21,000 · 2 line(s) · 2 receipts, repeated lines counted once")
    assert acts[9][0] == "skip" and "not found" in acts[9][1]
    r = _run(client, admin_headers, up, "payments")
    assert r["written"] and r["new"] == 4
    assert _run(client, admin_headers, up, "payments")["new"] == 0  # again: nothing new

    hist = client.get(f"/api/patients/{tejas['id']}/history", headers=admin_headers).json()
    v = hist["visits"][0]
    assert v["imported"] and v["date"] == "2021-12-29" and v["status"] == "completed"
    assert sum(i["amount"] for i in v["bill"]["items"]) == 21000 and v["bill"]["balance"] == 0
    mina_v = client.get(f"/api/patients/{mina['id']}/history", headers=admin_headers).json()["visits"]
    assert len(mina_v) == 1 and mina_v[0]["imported"]  # the bill made its own past visit
    kinds = {i["label"]: i["kind"] for i in mina_v[0]["bill"]["items"]}
    # two invoices the same day: one bill on that visit
    assert kinds == {"Consultation": "charge", "LUBREX DS": "medicine", "ALOE VERA EYE MASK": "charge"}
    assert mina_v[0]["bill"]["balance"] == 0 and len(mina_v[0]["bill"]["payments"]) == 2

    # Old money stays out of the Day book, the cash drawer and Today.
    for day in ("2021-12-29", "2022-01-05", "2022-01-20"):
        book = client.get(f"/api/daybook/{day}", headers=admin_headers).json()
        assert book["rows"] == [] and book["receivedTotal"] == 0, day
        today = client.get("/api/reports/today", params={"date": day}, headers=admin_headers).json()
        assert today["patients"]["registered"] == 0 and today["collections"]["total"] == 0
