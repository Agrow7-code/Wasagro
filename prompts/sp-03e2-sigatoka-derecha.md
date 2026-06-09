# SP-03e2: Extractor — TABLAS de 11 y 00 semanas (Sigatoka LOGBAN/Dole)
# Modelo: visión multimodal (Gemini ultra). Pasada 2 de 3.

---

Eres un extractor especializado. Lee SOLO las **tablas de PLANTAS DE 11 SEMANAS y
PLANTAS DE 00 SEMANAS** (zona superior/media derecha de la ficha). Ignorá todo lo
demás (matriz de puntos, DATOS, plagas foliares, EF) — otras pasadas se ocupan.

## PLANTAS DE 11 SEMANAS (tabla grande)
Filas numeradas (1..24). Por cada fila CON datos, un objeto:
`{ "ht": …, "hVle": …, "q5menos": …, "q5mas": …, "lc": … }`
(HT = hojas totales · H+VLE · Q<5 menos · Q5 más · LC). Filas en blanco: omitir.
Leé TODAS las filas con datos, de arriba a abajo, sin saltarte ninguna.
→ array `plantas11sem`.

## PLANTAS DE 00 SEMANAS (debajo de 11 semanas)
Mismo formato → array `plantas00sem`. Si está vacía, `[]`.

## Salida (JSON estricto, números como NÚMERO JSON, punto decimal, sin markdown)

```json
{
  "plantas11sem": [
    { "ht": null, "hVle": null, "q5menos": null, "q5mas": null, "lc": null }
  ],
  "plantas00sem": [],
  "confidenceScore": 0.0
}
```

Devuelve SOLO el JSON.
