// What is on hand, what is held, and the reservations that hold it. Holding is
// one step, with no await in it (ADR Stock is never oversold): available is on
// hand minus held, and never goes below zero.

import type { Availability, HeldReservation, Reservation, ReservationLine, ReservationStatus, ShortLine } from '@warehouse/contracts'

/** Goods on hand and held, by SKU. */
interface Item { onHand: number; held: number }

export class ShortStock extends Error {
  constructor(readonly short: ShortLine[]) {
    super(`Short of ${short.map((l) => l.sku).join(', ')}`)
  }
}
export class BadLine extends Error {}
export class UnknownReservation extends Error {}
export class WrongMove extends Error {}
export class ReusedKey extends Error {}

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0

/** The number in a reservation id: r-2 is made before r-10, though "r-10" sorts first as text. */
const numberOf = (id: string): number => Number(id.replace(/^r-/, ''))

const sameLines = (a: ReservationLine[], b: ReservationLine[]): boolean =>
  Array.isArray(b) && a.length === b.length && a.every((l, i) => l.sku === b[i]?.sku && l.quantity === b[i]?.quantity)

export class StockLedger {
  private items = new Map<string, Item>()
  private reservations = new Map<string, Reservation>()
  private byKey = new Map<string, Reservation>()
  private returnKeys = new Map<string, Reservation>()
  private next = 1

  /** Holds every line or none. A key already seen answers with its reservation, and only for the same lines. */
  reserve(key: string, lines: ReservationLine[]): Reservation {
    const known = this.byKey.get(key)
    if (known) {
      if (!sameLines(known.lines, lines)) throw new ReusedKey('That Idempotency-Key was used for another reservation')
      return known
    }
    if (!Array.isArray(lines) || !lines.length) throw new BadLine('A reservation needs at least one line')
    if (!lines.every((l) => typeof l?.sku === 'string' && isCount(l.quantity))) throw new BadLine('A line needs a SKU and a whole quantity above zero')
    const wanted = new Map<string, number>()
    for (const { sku, quantity } of lines) wanted.set(sku, (wanted.get(sku) ?? 0) + quantity)
    const short = [...wanted].flatMap(([sku, requested]) => {
      const available = this.availableOf(sku)
      return requested > available ? [{ sku, requested, available }] : []
    })
    if (short.length) throw new ShortStock(short)
    for (const [sku, quantity] of wanted) this.item(sku).held += quantity
    const reservation: Reservation = { id: `r-${this.next++}`, lines, status: 'held' }
    this.reservations.set(reservation.id, reservation)
    this.byKey.set(key, reservation)
    return reservation
  }

  get(id: string): Reservation | undefined {
    return this.reservations.get(id)
  }

  /** Gives held goods back. Releasing a released reservation changes nothing. */
  release(id: string): Reservation {
    const reservation = this.known(id)
    if (reservation.status === 'released') return reservation
    this.mustBeHeld(reservation, 'released')
    for (const { sku, quantity } of reservation.lines) this.item(sku).held -= quantity
    return this.become(reservation, 'released')
  }

  /** Takes held goods off the shelf. Doing it again changes nothing. */
  dispatch(id: string): Reservation {
    const reservation = this.known(id)
    if (reservation.status === 'dispatched') return reservation
    this.mustBeHeld(reservation, 'dispatched')
    for (const { sku, quantity } of reservation.lines) {
      const item = this.item(sku)
      item.held -= quantity
      item.onHand -= quantity
    }
    return this.become(reservation, 'dispatched')
  }

  /**
   * Puts the goods of a dispatched reservation back on the shelf (ADR Retried writes change nothing).
   * A key already seen for this reservation answers as it did, and changes nothing; a key seen for
   * another reservation is refused. Anything else not dispatched is refused and changes nothing.
   */
  returnReservation(key: string, id: string): Reservation {
    const returned = this.returnKeys.get(key)
    if (returned) {
      if (returned.id !== id) throw new ReusedKey('That Idempotency-Key was used for another return')
      return returned
    }
    const reservation = this.known(id)
    this.mustBeHeld(reservation, 'returned', 'dispatched')
    for (const { sku, quantity } of reservation.lines) this.item(sku).onHand += quantity
    this.returnKeys.set(key, this.become(reservation, 'returned'))
    return reservation
  }

  /** Every SKU the warehouse has a stock item for, sorted by SKU, even one with nothing on hand or held. */
  list(): Availability[] {
    return [...this.items.keys()].sort().map((sku) => this.availability(sku)!)
  }

  receive(sku: string, quantity: number): Availability {
    if (typeof sku !== 'string' || !sku || !isCount(quantity)) throw new BadLine('A delivery needs a SKU and a whole quantity above zero')
    this.item(sku).onHand += quantity
    return this.availability(sku)!
  }

  /** What is known of a SKU, or undefined for one the warehouse never had. */
  availability(sku: string): Availability | undefined {
    const item = this.items.get(sku)
    return item && { sku, available: item.onHand - item.held, onHand: item.onHand, held: item.held }
  }

  /**
   * The held reservations that hold goods of a SKU, sorted by the number in their id, each with the
   * quantity of that SKU it holds. Released, dispatched and returned reservations hold nothing and are left out.
   */
  holding(sku: string): HeldReservation[] {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.status === 'held')
      .flatMap((reservation) => {
        const quantity = reservation.lines.filter((l) => l.sku === sku).reduce((sum, l) => sum + l.quantity, 0)
        return quantity > 0 ? [{ id: reservation.id, quantity }] : []
      })
      .sort((a, b) => numberOf(a.id) - numberOf(b.id))
  }

  private availableOf(sku: string): number {
    return this.availability(sku)?.available ?? 0
  }

  private item(sku: string): Item {
    let item = this.items.get(sku)
    if (!item) this.items.set(sku, item = { onHand: 0, held: 0 })
    return item
  }

  private known(id: string): Reservation {
    const reservation = this.reservations.get(id)
    if (!reservation) throw new UnknownReservation(`No reservation ${id}`)
    return reservation
  }

  private mustBeHeld(reservation: Reservation, to: ReservationStatus, from: ReservationStatus = 'held'): void {
    if (reservation.status !== from) throw new WrongMove(`A ${reservation.status} reservation cannot become ${to}`)
  }

  private become(reservation: Reservation, status: ReservationStatus): Reservation {
    reservation.status = status
    return reservation
  }
}
