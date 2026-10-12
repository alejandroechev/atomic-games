# Atomic Games

Playable explanations of real systems. Each game is a **single self-contained
HTML file** — no build step, no network, no tracking, no storage. Open it and it
runs.

**→ [Play them here](https://alejandroechev.github.io/atomic-games/)**

Prose tells you the rules. A simulation lets you poke them. Only a game makes you
commit to a belief and pay for being wrong, and that payment is where conceptual
understanding comes from.

## Games

| Game | System | What it attacks |
|---|---|---|
| [**Inside the Encoder**](https://alejandroechev.github.io/atomic-games/games/video-codec/) | Modern video encoders and decoders | “More bitrate means better quality, and the codec decides how good it looks.” |

### Inside the Encoder

Seven levels, each introducing exactly one decision a real encoder makes:
quantization, the transform, prediction, motion, partitioning, the
rate–distortion tradeoff, and rate control over a channel that will not wait.

It runs an actual codec written into the page — a separable 8×8 DCT-II, a
deadzone quantizer on H.264's logarithmic step ladder, an Exp-Golomb run/level
entropy coder, intra prediction from genuinely reconstructed neighbours,
rate-constrained full-search motion estimation against reconstructed references,
bidirectional prediction, macroblock partitioning, Skip, a `J = D + λR` mode
decision, and a leaky-bucket decoder buffer. Error propagation and drift are not
scripted; they emerge, because the references really are the reconstructions.

Every bit count and every decibel the game shows you was produced by actually
encoding something. The page states its own fidelity contract — what it
simulates and what it leaves out — in the debrief.

## Method

These are built with the **generalized Atomic Intrinsic Integration** method.

The original was defined by Echeverría, Barrios, Nussbaum, Améstica and Leclerc
for games teaching conceptual physics. It fused *intrinsic integration* (Habgood
& Ainsworth) — the learning content must *be* the core mechanic — with an
*atomic analysis* of game structure (Koster, Cousins, Cook), where a game is a
lattice of feedback loops of the form *action → computation → feedback*. It was
validated experimentally: students who played the redesigned version scored
significantly better and held fewer misconceptions than those who played the
original.

Generalizing it from physical laws to arbitrary systems means four substitutions:

| Physics assumption | Generalization |
|---|---|
| The mechanism is a closed-form law | **Mechanism** — also algorithms, protocols, policies, queues, searches |
| Variables are numeric scalars and vectors | **Lever** — also choices, orderings, topologies, timings, allocations |
| The dependent variable is merely unseen | **Readout** — also lagged, stochastic, aggregate, counterfactual |
| Obstacles supply the challenge | **Reflection Tax** — any cost structure that prices thrashing |

The design loop:

1. **Model the system.** Levers, mechanisms, readouts, coupling, and the
   conserved quantity nobody can conjure more of. That last one is where the
   tension lives.
2. **Write down the misconceptions.** They are the real specification. A level
   that cannot be lost by someone holding the wrong belief is not attacking
   anything.
3. **Atomize.** One lever per low-level atom, one readout per mechanism, the
   coupling drawn beside its parts, the goal on top.
4. **Audit for intrinsic integration.** Every learning objective must lie on the
   critical path to winning; anything on that path teaching nothing is friction.
   Optional learning is skipped learning.
5. **Choose representations whose form matches the concept's structure.** Vectors
   become arrows, not numbers. Sums become stacked bars. Tradeoffs become planes.
6. **Scaffold, then fade** — present → degraded → absent → inverted. Scaffolding
   left in place is a trap: with the readouts permanently on, players beat every
   level by trial and error and learn nothing. This was the precise defect the
   original study found and fixed.
7. **Charge a Reflection Tax.** A challenge is doing its job when a wrong action
   costs more than a moment of thought — and the loss must be the system's *own*
   failure mode, not a timer bolted on.

Two rules every game here keeps:

- **Simulate the mechanism; never fake the readout.** If a bar says “bits”,
  something counted bits.
- **State what the model omits**, in prose, inside the artifact.

## Repository layout

```
index.html                     landing page (GitHub Pages root)
games/video-codec/
  index.html                   the built, standalone game — this is the artifact
  build.py                     inlines src/ into index.html
  src/engine.js                the codec: DCT, quantizer, entropy coder, motion, RD
  src/game.js                  the seven levels
  src/page.html                static markup and prose
```

Rebuild after editing anything in `src/`:

```sh
cd games/video-codec && python3 build.py
```

The built `index.html` is committed on purpose: the artifact has to keep working
from a `file://` URL with no toolchain.

## Licence

MIT.
