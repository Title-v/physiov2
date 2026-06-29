# Patient App Route Group

`/patient/` now serves the current `apps/patient/` static app through a
`public/patient/` symlink and a Next rewrite for `/patient`. The UI lives in
`apps/patient/` during the migration, and it keeps using shared pose, boundary,
angle overlay, exercise, and motion logic.
