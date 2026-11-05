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

![A person opens a ticket. The model agent models the change of the whole system on a branch, says on the ticket what it understood, and a review agent reads the change against the ticket. After a green Gate the system loop starts the Warehouse first, because the Shop calls it, then the Shop, each building on the same branch. A coding agent's question goes to the model agent, who answers in the model, and the loop builds again. When every Gate is green, the evidence goes on the ticket, a person accepts it all at once, and the loop merges the model first, then the code.](https://raw.githubusercontent.com/radicaltools/radical.tools.sdlc.demo.3.architecture/main/docs/sdlc.svg)

Yellow is a person, violet an agent on Claude Code, and green has no AI and gives the same answer every time. The dark boxes are the Gates, the one required check of each repository.

Tickets go to [the architecture repository](https://github.com/radicaltools/radical.tools.sdlc.demo.3.architecture#how-a-change-gets-through),
never here. A change lives on the branch `change/<n>` of its ticket, in the architecture repository and in each
repository it touches. When this repository's part of the model on that branch is not built, its coding agent builds
it there, in a draft pull request with the proof of its tests, and the Gate decides. When a change crosses both
repositories, this one goes first, because the Shop calls it. Nobody merges here by hand: a person accepts the whole change on its ticket, and the
loop merges every pull request of it.

The sensor `crosses` runs a pull request's code with the Shop's code on the same change's branch, or else its main branch,
so a change that breaks what the Shop calls or reads, with nothing for the Shop on the branch, is red here.

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
