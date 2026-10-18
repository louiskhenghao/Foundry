# ADR-0042: Subjects with pictures on the Brief, and a Likeness review of each milestone

**Status:** accepted · 2026-10-18 · amends ADR-0031

## Context

A goal whose result depicts something real (a particular car, a building, a product) was built and judged from words.
The worker modelled the thing from the prompt and its memory; the task reviewer read the diff, and for media and CAD
the files; the milestone recordings were taken and shown to the person, but no model ever looked at them. A 3D showcase
for one particular car can come out with a model that is recognisably a sports car and far from that car while every
review passes: a task that builds the model procedurally is reviewed from its diff and its command output alone.

The Style Sample already lets the person *see* before approving, but it pins a feel, not a likeness; the person's
attached images are untagged; and a Delegated goal keeps the chosen style without its image.

## Decision

- **Subjects on the Brief.** `brief.subjects`: up to four real things the result depicts (a vehicle, building, landmark,
  product or artwork, never a person), each with a name precise enough to search for, what must match (`lookFor`) and its
  pictures. The Clarifier names them for goals with a look (code goals with a user interface, image, video and CAD) and
  lists the user's attached images of each, which become the person's pictures.
- **Pictures outside the repository.** Pictures live under `<dataDir>/subjects/<goal>/`, named `<key>-<n>.<type>`: they
  never land and are never delivered, survive a Re-run Clarify, travel with a Transfer, and go to the attachments' trash
  with a deleted goal. Only real image files are kept (PNG, JPEG, WebP or GIF by their first bytes, at most 5 MB).
  Sessions are told the pictures are for comparison only: never copied, traced or embedded.
- **The search.** While the Brief waits, each Subject with no picture that was never searched gets one session (the
  Style samples model, at most $1.50 and 6 minutes, the worker's tools): it searches the web, downloads with curl into an
  incoming folder, opens each file to check it shows exactly this one, and lists what it kept. The engine keeps the files
  that are pictures. Approval waits while a search runs, as it does for the Investigation, and so does a Delegated goal's
  approval by the engine. A failed or empty search is not repeated by itself; **Find more** searches again.
- **Server-owned.** Subjects change only through their own events (`brief.subject_set`, `brief.subject_removed`,
  `brief.subject_pictures`, `brief.subject_searched`); a Brief saved or approved from the page keeps the stored Subjects,
  so a page holding an edited copy never drops pictures that arrived meanwhile.
- **Workers and reviewers.** A worker on a task with a look (frontend, fullstack, mobile, image, video, cad, general)
  gets `# Subjects` with the pictures by absolute path, their folder added to the session: open them first; when the task
  makes a Subject itself, render it from the pictures' views under `artifacts/renders/` and compare before finishing. The
  task reviewer compares the same pairs (the images, frames, snapshots or renders) and blocks a difference someone who
  knows the subject would notice at a glance, and a task that made a Subject and left nothing to compare. The goal
  reviewer gets the pictures and the latest Likeness review of each milestone.
- **The Likeness review.** When a milestone is recorded (not by the final walkthrough, not a failed recording) in a goal
  whose Subjects have pictures, one read-only session on the Task reviewer model (at most $0.80) opens up to eight of the
  recording's screenshots, a milestone of files' images and frames of its clips, next to the pictures, and returns per
  Subject whether it is shown, a likeness out of ten, what matches and what differs, each difference major or not. It is
  recorded as `milestone.likeness` and shown under the recording.
- **One fix per milestone.** When a shown Subject has a major difference and the goal still works, the engine adds one
  task (origin `likeness-fix`, after every finished task, `checkpointOf` the milestone, so it re-opens it like a feedback
  fix) with the differences and both sets of pictures. The recording after it lands is reviewed again and only reported.
  The notification channels hear of the fix.
- **Inheritance.** A Delegated goal and a Follow-up start with the Subjects of the goal they come from, pictures copied;
  their Clarifier is told so and does not name them again, and only a new Subject is searched.
- **No new model role.** A role is a column of every saved preset; the search runs on the Style samples model and the
  review on the Task reviewer model.

## Consequences

- Work on real things is built and judged against pictures, and the person sees on the Brief what it will be compared
  with before anything expensive runs.
- A Brief with Subjects waits a few minutes for the search before it can be approved; a search costs about a dollar,
  and each reviewed milestone costs about as much as a task review.
- Workers that make a Subject spend part of their session rendering it; the renders land as artifacts.
- Pictures found on the web belong to others: they stay on this computer as references, outside the repository and the
  delivery. The search depends on the coding agent's web access; where it has none, the search fails and the person adds
  their own pictures.
- Not covered: people (likeness of a person is never a Subject), judging video beyond a few frames, and a review of the
  final walkthrough (each milestone was reviewed when it was recorded).
