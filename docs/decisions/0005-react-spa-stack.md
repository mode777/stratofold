# 0005 — SPA: React + Vite + TypeScript + Tailwind

Status: Accepted (2026-10)

## Context

The vision requires a state-of-the-art, mobile-first responsive SPA with a
Google-Drive-like custom design, virtualized file lists, and background
uploads. The stack was chosen by product fit (ecosystem support for those
three UI problems) rather than raw performance.

## Decision

Build the SPA with React + Vite + TypeScript, styled with Tailwind CSS and
headless components (custom design system, Drive-like). Use the PocketBase
JS SDK for auth/records, React Router for routing, and a virtualized-list
library (e.g. TanStack Virtual) for large directory views. Uploads run
through an in-app upload-manager service that keeps uploading while the
user navigates; service-worker resilience is a future extension.

## Consequences

Largest ecosystem for the Drive-like widget set (drag & drop, virtualized
lists, upload queues) and the broadest AI/hiring support. Accepted cost: a
somewhat larger bundle than Svelte/Solid — irrelevant next to
tens-of-gigabyte transfers, and Tailwind's output stays small.

## Rejected alternatives

- Vue 3, Svelte 5, SolidJS: viable, but smaller ecosystems for the exact
  widget needs; Svelte/Solid bundles win nothing here.
- Off-the-shelf component library (MUI/Mantine): faster start but heavier
  bundle and constant fighting to match the Drive-like custom design.
