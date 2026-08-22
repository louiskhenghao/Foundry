#!/bin/sh
# SessionStart canary: proves that --settings hooks were accepted for this run.
# The runner checks for a `hook` event named SessionStart in the stream; if absent, the
# settings JSON was silently ignored and the boundary guard is NOT active => fail closed.
exit 0
