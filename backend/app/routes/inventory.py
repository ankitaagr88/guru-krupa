"""Stock levels (`renderInventory`, `addInventoryItem`, `adjustStock`) and movement history."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import FRONT_DESK
from app.db import get_db
from app.models.pharmacy import InventoryItem
from app.models.staff import Staff
from app.routes import register
from app.schemas.pharmacy import OrderPlacedIn, InventoryItemIn, InventoryItemOut, InventoryItemPatch, MovementOut, StockAdjustIn
from app.services import pharmacy as svc

router = register(APIRouter(prefix="/inventory", tags=["inventory"], dependencies=[Depends(get_current_user)]))


def _get(db: Session, item_id: int) -> InventoryItem:
    item = db.get(InventoryItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Inventory item not found")
    return item


def _422(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.get("", response_model=list[InventoryItemOut])
def list_inventory(db: Session = Depends(get_db)):
    return [svc.inventory_out(i) for i in svc.list_inventory(db)]


@router.get("/low", response_model=list[InventoryItemOut])
def low_stock(db: Session = Depends(get_db)):
    """Items at or below their reorder level (`pushLowStockToast`)."""
    return [svc.inventory_out(i) for i in svc.list_inventory(db, low_only=True)]


@router.post("", response_model=InventoryItemOut, status_code=status.HTTP_201_CREATED)
def create_item(data: InventoryItemIn, db: Session = Depends(get_db), user: Staff = Depends(require_role(*FRONT_DESK))):
    """`addInventoryItem`; with only `medicineId` the item takes the medicine's name."""
    try:
        item = svc.create_item(db, name=data.name, unit=data.unit, stock=data.stock,
                               reorder_level=data.reorder_level, medicine_id=data.medicine_id, by=user)
    except svc.Duplicate as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    except (svc.BadValue, svc.NegativeStock) as exc:
        raise _422(exc)
    return svc.inventory_out(item)


@router.get("/{item_id}", response_model=InventoryItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    return svc.inventory_out(_get(db, item_id))


@router.patch("/{item_id}", response_model=InventoryItemOut)
def patch_item(item_id: int, data: InventoryItemPatch, db: Session = Depends(get_db),
               user: Staff = Depends(require_role(*FRONT_DESK))):
    item = _get(db, item_id)
    try:
        svc.update_item(db, item, data.model_dump(exclude_unset=True, exclude_none=True), user)
    except svc.Duplicate as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    except svc.BadValue as exc:
        raise _422(exc)
    return svc.inventory_out(item)


@router.post("/{item_id}/adjust", response_model=InventoryItemOut)
def adjust(item_id: int, data: StockAdjustIn, db: Session = Depends(get_db),
           user: Staff = Depends(require_role(*FRONT_DESK))):
    item = _get(db, item_id)
    try:
        svc.adjust_stock(db, item, data.delta, data.reason, data.note, user)
    except svc.NegativeStock:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Stock of '{item.name}' cannot go below zero")
    except svc.BadValue as exc:
        raise _422(exc)
    return svc.inventory_out(item)


@router.post("/{item_id}/ordered", response_model=InventoryItemOut)
def mark_ordered(item_id: int, data: OrderPlacedIn, db: Session = Depends(get_db),
                 user: Staff = Depends(require_role(*FRONT_DESK))):
    """An order for `qty` has been placed: the low-stock alert stays quiet until stock is received."""
    return svc.inventory_out(svc.mark_ordered(db, _get(db, item_id), True, user, data.qty))


@router.delete("/{item_id}/ordered", response_model=InventoryItemOut)
def clear_ordered(item_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*FRONT_DESK))):
    return svc.inventory_out(svc.mark_ordered(db, _get(db, item_id), False, user))


@router.get("/{item_id}/movements", response_model=list[MovementOut])
def item_movements(item_id: int, db: Session = Depends(get_db)):
    return [svc.movement_out(m) for m in svc.movements(db, _get(db, item_id))]
