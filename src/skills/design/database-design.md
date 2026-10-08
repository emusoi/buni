---
name: database-design
description: Designing tables in a store — keys, types, nullability, foreign keys, and naming — so data outlives the code that writes it. Read before set_table.
---
# Database design

Tables last longer than services. Model the facts of the business, not the screens.

## Tables and names
- snake_case, plural table names (`quotes`), singular column names (`plan_id`).
- One table per thing that has its own identity and lifecycle. A list inside a row (`line_items` JSON) is a missing table once you query it.

## Keys
- Every table has one primary key column: `id uuid` unless there is a reason (a natural key that truly never changes).
- A foreign key column is `<thing>_id` with `ref` to that table's `id`. Always set `ref`, so buni checks it.
- Join tables for many-to-many: two foreign keys, and `unique` on the pair when order doesn't matter.

## Columns
- Not null by default; mark `nullable` only when "unknown" is a real state, and say what null means in the endpoint summary.
- Money is `numeric(12,2)` or integer minor units, never float. Time is `timestamptz`, stored in UTC.
- `created_at timestamptz` on everything; `updated_at` where rows change.
- Use `unique` for what the business says is unique (email, slug). It is a rule, not an optimisation.
- Status fields are `text` with the allowed values written in a decision, until they need a table.

## Ownership
- One service writes each store. Others read through its endpoints or subscribe to its events.
- Soft delete (`deleted_at`) only when someone will actually restore rows; otherwise delete.
- Record retention and privacy rules as decisions ("quotes kept 7 years", "email is personal data").
