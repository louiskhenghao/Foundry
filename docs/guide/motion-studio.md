# Motion studio

*Beta: switch it on under [Settings → Beta](./settings.md#beta).* A second way to make a video goal: instead of a video skills pack alone, the goal follows the **motion-studio** engine, a small studio harness that Foundry ships and the worker never has to rebuild: a renderer that paints any moment of the film on demand, a critique loop that makes the worker look at its own frames before it hands anything in, a fixed set of deliverables, and checks that measure them.

## Choosing the engine

With the Beta switch on, a video goal on the New goal form shows an **Engine** picker under *Kind of goal*. Leave it on the pack Settings names, or pick **motion-studio**. The choice is frozen when the goal is created, like the workflow suite; the goal's sessions build their prompts with it, and the Extensions catalog, the doctor and the Video skills pack of Settings stay as they are for every other goal.

## What the goal needs on this computer

The engine renders through a headless Chromium and encodes with ffmpeg. Foundry drives the Chromium it already ships for its own self-check; **ffmpeg** has to be on the computer (`brew install ffmpeg` on a Mac; the Docker image carries it). The doctor on the Setup page checks both when the Beta switch is on, and a motion-studio goal waits until they are there, the way a CAD goal waits for its tools.

## Sessions that run long

A film is built and rendered in sessions longer than a code change: every goal can now carry its own **Attempt timeout** (Custom budget on the New goal form, 5 to 240 minutes), which caps one session of that goal; blank keeps [Settings → Models & limits](./settings.md#models--limits). A motion-studio goal is created with 60 minutes.
