"""Single source of truth for the 7 machines (`TEST_TYPES` in the mockup): display label,
field labels in display order, whether it is manual-entry only, the Tesseract config and the parser."""
from dataclasses import dataclass
from types import ModuleType
from typing import Callable

from app.models.readings import MACHINE_KEYS
from app.ocr.templates import (clm1_lensmeter, hnt1p_tono, hrk8000a_ker, hrk8000a_ref, tbut_schirmer,
                               ypc100k_ker, ypc100k_ref)


@dataclass(frozen=True)
class Machine:
    key: str
    label: str
    fields: tuple[str, ...]
    manual_only: bool
    tess_config: str
    parse: Callable[[str], list[dict]]

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "fields": list(self.fields), "manualOnly": self.manual_only}


def _from_module(mod: ModuleType) -> Machine:
    return Machine(key=mod.KEY, label=mod.LABEL, fields=tuple(mod.FIELDS), manual_only=mod.MANUAL_ONLY,
                   tess_config=mod.TESS_CONFIG, parse=mod.parse)


_MODULES = (hnt1p_tono, hrk8000a_ref, hrk8000a_ker, clm1_lensmeter, ypc100k_ref, ypc100k_ker, tbut_schirmer)
MACHINES: dict[str, Machine] = {m.KEY: _from_module(m) for m in _MODULES}

assert tuple(MACHINES) == MACHINE_KEYS, "app.ocr.templates must define exactly the model's MACHINE_KEYS in order"


def get_machine(key: str) -> Machine | None:
    return MACHINES.get(key)


def machine_label(key: str) -> str:
    m = MACHINES.get(key)
    return m.label if m else key
