# radical.sdlc.demo.warehouse

**The Warehouse of [radical.sdlc.demo](https://github.com/radicaltools/radical.sdlc.demo.architecture#readme)**: what is on
the shelves, what is held for paid orders, and sending the goods with the carrier. The [Shop](https://github.com/radicaltools/radical.sdlc.demo.shop)
calls it over HTTP.

This repository holds code and no model. The model of the whole system, the Warehouse and the Shop together, is in the
[architecture repository](https://github.com/radicaltools/radical.sdlc.demo.architecture), and so is the pipeline that
brings changes here. Agents write most of the code here, from that model, and a person accepts it.

## What it does

![An operator records deliveries in the stock service. The Shop reserves goods, all of a reservation or none, and is told what is short. To send them it asks the dispatch service, which books the carrier once per key and has the stock service take the goods off the shelf.](docs/requests.svg)

Each lane is who does the step. A red arrow is a refusal, and it changes nothing.

**The stock service** (`services/stock`, port 3011) knows what is on hand and what is held:

- `POST /stock/receipts` records goods that arrived; `GET /stock`, `GET /stock/{sku}` and `GET /stock/{sku}/reservations` read.
- `POST /reservations` holds every line of an order or none, and answers what is short. Named by an `Idempotency-Key`,
  so a retried reservation holds once.
- A reservation is released, dispatched or returned (`POST /reservations/{id}/release`, `/dispatch`, `/return`), as
  its state machine in the model allows.

**The dispatch service** (`services/dispatch`, port 3012) sends the goods:

- `POST /dispatches` books the carrier for a held reservation, once per key, with the delivery address the Shop gives,
  passed on as it is, and has the stock service take the goods off the shelf. When the carrier cannot be reached, the
  reservation stays held and the answer is 503.
- `GET /dispatches/{reservationId}` answers the tracking number, the carrier's status, the estimated delivery date and,
  once delivered, the time of delivery, each as the carrier gave it.

Both are described in their `openapi.yaml`, and `packages/contracts` holds the types they share, with no behaviour.

## How the model reaches the code

```
.radical/radical.json     which folder builds which element of the model, which test checks which scenario,
                          and where the model is ("model": the architecture repository)
.radical/reconciled.json  the commit of the model this code has reached
.radical/sensors/         what measures this repository's own fitness functions
tools/model.mjs           fetches the model into .radical/model, out of git
```

The model names this repository's elements: the Warehouse, its two services and the shared contracts. Those, and all
that hangs on them, are **its part**: the requirements they satisfy, the reservation's state machine, the scenarios, the
decisions that constrain them and their fitness functions. The `radical` CLI judges this repository on that part only.

A change of the system lives on a branch `change/<n>` here and in the architecture repository. When the model on that
branch asks for something of this part, the pipeline there starts this repository's `reconcile.yml`. Its coding agent
reads what changed in the model (never the ticket), builds it on `change/<n>`, binds the tests to the scenarios, and opens
a draft pull request with the proof of its tests: each test of a changed scenario fails with the code of `main` and
passes with the branch's. What the model does not say, it asks the model agent. When a change needs both systems, the
Warehouse goes first, because the Shop calls it.

Nobody merges here by hand. A person accepts the whole change on its ticket in the architecture repository, and the
pipeline merges the model and every repository's pull request of it.
[How a change gets through](https://github.com/radicaltools/radical.sdlc.demo.architecture#how-a-change-gets-through) is there.

## The Gate

Every pull request here runs the standards' Gate, the one required check, with no AI: the type check, the tests, the
sensors of the fitness functions triggered on a pull request, a check that each agent stayed in its scope, and
`radical check` of this repository's part.

| Fitness function | Sensor | Runs |
|---|---|---|
| Services stay on their own (standards) | `boundaries` | every pull request, for each service |
| API matches its description (standards) | `openapi` | every pull request |
| Repeated write changes nothing (standards) | `idempotency` | every pull request |
| Order crosses the systems | `crosses`: this code with the Shop's of the same change, or its `main`, running together | every pull request |
| Rules hold in random sequences (standards) | `fuzz` | at night: not run in this demo yet |
| No oversold stock | `oversell`: 200 reservations at once for 50 items | at night: not run yet |
| Reservation reaches the carrier | `smoke`: the running stack, end to end | on deploy: not run yet |

## Built from the model

[The pull request](https://github.com/radicaltools/radical.sdlc.demo.warehouse/pull/13) that takes the delivery address
came from the coding agent, on `change/22`, with no ticket here. It asked the model agent four times while the model
was not enough, built again each time the model said more, and carries the proof of its tests. A person accepted it
together with the model and the Shop's part.

Findings of exploratory rounds are in `.radical/crucible/findings`, some of them still open.

## Run it on your machine

```bash
npm ci
npm run standards        # .radical/model, .standards/ at the model's tag, and the agents' skills
npm test
npm run stack            # the services on :3011 and :3012, with a stand-in for the carrier on :3013
```

The whole model opens in [Radical Studio](https://radical.tools) from the architecture repository.
