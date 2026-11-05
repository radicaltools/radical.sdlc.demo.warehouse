# Exploring the warehouse

The brief of an exploratory round (Radical Crucible). The warehouse runs on real ports, and
you use it as a client would, over HTTP. Its model says what must hold.

## How to tell that something is wrong

- A requirement of the model does not hold. Its EARS text is the rule, and a scenario is
  only one example of it. Look at what the rule says beyond the example.
- A request gets a 5xx answer other than the dispatch service's 503, which means the carrier or
  stock cannot be reached. A bad request is the client's mistake and gets a 4xx.
- A quantity available is negative, or is not on hand minus held.
- A reservation moves in a way its lifecycle does not allow, or a refused request changed something.
- The same idempotency key holds or books twice.

## Where to look

Inputs no test tries: zero, negative, huge, fractional, empty, missing, the wrong type,
names like `constructor`. Every route, not only the one a scenario names. The same call
twice, and steps out of order. A delivery has to come first, or there is nothing to reserve.

## How to drive it

Write small `.mjs` scripts with `fetch`, in your run's folder. Each one reproduces one
problem: it prints what it saw, and exits with status 3 when the problem is there and 0
when it is not. The ports are in your prompt: the app port is the stock service, the hub
port is the dispatch service, and the other port is a stand-in for the carrier.
