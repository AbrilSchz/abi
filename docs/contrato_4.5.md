# Contrato 4.5 — `config_health.json`

Archivo opcional en `public/data/<dataset_id>/config_health.json`. Si falta, `src/health_defaults.js` provee todos los valores.

## Estructura

```json
{
  "dataset_id": "jezero_test",
  "body_mass_kg": 82,
  "suit_mass_kg": 62,
  "terrain_factor": 1.2,
  "group_size": 3,
  "members": [
    { "id": "cdr", "role": "commander", "body_mass_kg": 82, "age_years": 45, "sex": "male", "fitness_level": "fit" }
  ]
}