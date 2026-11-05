# radical.tools.sdlc.demo.3.warehouse

The Warehouse, one of the repositories that build one system with one model. [The architecture
repository](https://github.com/radicaltools/radical.tools.sdlc.demo.3.architecture#readme) holds the model
and says how it all fits together. This repository holds code, and two files about the model:

```
.radical/radical.json     which folder builds which element, which test checks which scenario
.radical/reconciled.json  the commit of the model this code has reached
.radical/sensors/         what measures its own fitness functions; the standards' are in .standards/
tools/model.mjs           fetches the model into .radical/model, out of git
```

## What it does

![An operator records deliveries in the stock service. The Shop reserves goods, all of a reservation or none, and is told what is short. To send them it asks the dispatch service, which books the carrier once per key and has the stock service take the goods off the shelf.](docs/requests.svg)

Each lane is who does the step. A red arrow is a refusal, and it changes nothing.

`GET /dispatches/{reservationId}` answers the tracking number, the carrier's status and the estimated delivery date of
a dispatched reservation. The date is kept as the carrier gave it when it booked the parcel, or null if it gave none: a
booked parcel goes on either way.

## How a change gets here

![A person opens a ticket. The model agent changes the model of the whole system in one pull request. A green Gate and a person's merge start the system loop, which reads what each repository has left and starts the Warehouse first, because the Shop calls it. Its coding agent builds its part, a green Gate and a merge start the loop again, and it starts the Shop. When nothing is left, the loop closes the ticket.](https://raw.githubusercontent.com/radicaltools/radical.tools.sdlc.demo.3.architecture/main/docs/sdlc.svg)

Yellow is a person, violet an agent on Claude Code, and green has no AI and gives the same answer every time. The dark box is the Gate, the one required check.

Tickets go to [the architecture repository](https://github.com/radicaltools/radical.tools.sdlc.demo.3.architecture#how-a-change-gets-through),
never here. When this repository's part of the model is not built, the coding agent proposes the code in a pull
request, and the Gate decides. When a change crosses both repositories, this one goes first, because the Shop calls it.

The sensor `crosses` runs a pull request's code with the Shop's main branch, so a change that breaks what the Shop calls or
reads is red here, before it merges. A rename goes in steps: add the new name, move the Shop, then remove the old one.

## Built from the model

[The pull request](https://github.com/radicaltools/radical.tools.sdlc.demo.3.warehouse/pull/3) that added the estimated delivery date came from the coding agent, with no ticket here. It
read what changed in the model, built the part this repository answers for, bound its tests to the scenarios, and left
the Shop's part alone. Its Gate read 28 of 28 requirements verified.

Findings of exploratory rounds are in `.radical/crucible/findings`, some of them still open.

## Run it on your machine

```bash
npm ci
npm run standards        # .radical/model (this repository's part), .standards/, and the agents' skills
npm test
npm run stack            # the services on :3011 and :3012, with a stand-in for the carrier
```

The whole model opens in [Radical Studio](https://radical.tools) from the architecture repository.
