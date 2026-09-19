"""Terminal simulator: run the whole intake conversation without WhatsApp.

    python simulate.py gurukrupa                 # interactive
    python simulate.py gurukrupa --phone 919000000002
    printf "1\nRamesh Patel\n45\n1\nVesu, Surat\n9876543210\n1\n" | python simulate.py gurukrupa

Buttons / list rows are shown as numbered options: type the number (or the label).
Type "Hi" to restart, "quit" to exit. Records are appended to data/simulate-<clinic>.csv.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import CLINICS_DIR, load_clinic  # noqa: E402
from app.conversation import Conversation  # noqa: E402
from app.db import make_session_factory  # noqa: E402
from app.destinations.csv_file import CsvDestination  # noqa: E402
from app.messages import IncomingMessage  # noqa: E402
from app.providers.console import ConsoleProvider  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clinic", help="clinic id = YAML file name under clinics/ (e.g. gurukrupa)")
    ap.add_argument("--phone", default="919000000001", help="pretend patient WhatsApp number")
    ap.add_argument("--db", default="sqlite:///./data/simulate.db")
    args = ap.parse_args()

    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")

    path = CLINICS_DIR / f"{args.clinic}.yaml"
    if not path.exists():
        print(f"no such clinic config: {path}", file=sys.stderr)
        return 2
    clinic = load_clinic(path)
    clinic.destination.path = f"data/simulate-{clinic.id}.csv"
    clinic.destination.backoff_seconds = 0
    destination = CsvDestination(clinic.destination, clinic)
    provider = ConsoleProvider()
    convo = Conversation(clinic, destination, make_session_factory(args.db))

    print(f"=== {clinic.name} — WhatsApp intake simulator ===")
    print(f"You are {args.phone}. The QR pre-fills '{clinic.qr_trigger}'; sending it now.")
    print(f"Completed forms go to {clinic.destination.path}\n")

    def deliver(msg: IncomingMessage) -> None:
        for reply in convo.handle(msg):
            provider.send(args.phone, reply)

    deliver(IncomingMessage(from_phone=args.phone, text=clinic.qr_trigger))

    while True:
        try:
            line = input("\n[you] ").strip()
        except EOFError:
            print()
            break
        if not line:
            continue
        if line.lower() in ("quit", "exit"):
            break
        msg = IncomingMessage(from_phone=args.phone, text=line)
        if line.isdigit() and provider.last_options and 1 <= int(line) <= len(provider.last_options):
            opt = provider.last_options[int(line) - 1]
            msg = IncomingMessage(from_phone=args.phone, selected_id=opt.id, selected_title=opt.title)
        deliver(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
