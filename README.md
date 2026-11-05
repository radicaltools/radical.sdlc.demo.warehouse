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

## Found by the agents

The Warehouse started with two scenarios that no test checked, one of them hiding a bug. What happened to them shows the
pipeline at work:

| Where | What was wrong | Who found it | Now |
|---|---|---|---|
| Scenario *Same key, other body* | no test, and the stock service answered as if it were a repeat, where it should answer 422 | testing agent, on [the first ticket](https://github.com/radicaltools/radical.tools.sdlc.demo.3.warehouse/pull/3), and the explore agent the same night | fixed by the coding agent, in that pull request; recorded as [F-0002](.radical/crucible/findings/F-0002.md) |
| Scenario *No release after dispatch* | no test, the code was right | testing agent, in [its proposal](https://github.com/radicaltools/radical.tools.sdlc.demo.3.warehouse/pull/5) | has its test |
| ADR *Retried writes change nothing* | two dispatches at once with one key book the carrier twice | explore agent, at night, in [the findings it proposed](https://github.com/radicaltools/radical.tools.sdlc.demo.3.warehouse/pull/4) | [F-0001](.radical/crucible/findings/F-0001.md), open, waiting for the coding agent |

## Run it on your machine

```bash
npm ci
npm run standards        # .radical/model (this repository's part), .standards/, and the agents' skills
npm test
npm run stack            # the services on :3011 and :3012, with a stand-in for the carrier
```

The whole model opens in [Radical Studio](https://radical.tools) from the architecture repository.
`npm run hooks` keeps the other models and the test results of CI up to date.
