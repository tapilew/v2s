![V2S](assets/brand/v2s-logo-horizontal.png)

# V2S

Habla o escribe, y el teléfono lo convierte en filas de una hoja de cálculo que abres en Google Sheets. La conversión a hoja de cálculo es el producto. La app trae dos plantillas sobre el mismo motor. **Finanzas** registra tus movimientos y te muestra cuánto ahorras. **Salud** registra los equipos médicos que un colaborador de campo ve en cada hospital. Toda la inteligencia artificial corre en el teléfono con el SDK de QVAC. Lo que dices y escribes no sale del dispositivo.

Tracks: Desafío General, Reto Caja de Ahorros, Reto Philips (Inteligencia de Base Instalada de Clientes) y Reto Tether QVAC Psy.

## Cómo funciona

1. Toca el nombre de la hoja arriba a la izquierda y elige **Finanzas** o **Salud**.
2. Escribe en el cuadro de texto o toca el micrófono. Parakeet transcribe el audio en el teléfono y agrega el texto al cuadro, donde puedes corregirlo.
3. Toca **Agregar a la hoja**. La app guarda tu texto antes de procesarlo, así que nunca se pierde.
4. Un modelo de QVAC extrae los datos con salida restringida por un JSON Schema y un ejemplo resuelto.
5. La app verifica cada valor contra tu texto. Lo que no aparece en lo dicho queda vacío, y la fila se marca con **Revisar**.
6. Toca **Exportar a Google Sheets**. Android abre el menú de compartir con el archivo CSV, listo para Google Drive o Sheets.

## Hoja de Finanzas

Pensada para quien tiene una cuenta de ahorros y quiere ordenar su dinero sin entregarle sus gastos a un tercero.

"Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo" se convierte en:

| Fecha | Concepto | Tipo | Categoría | Monto | Método |
| --- | --- | --- | --- | --- | --- |
| 2026-09-10 | Luz | Gasto | Servicios | 45 | Yappy |
| 2026-09-10 | Almuerzo | Gasto | Alimentación | 12 | Efectivo |

Arriba de la hoja, la app resume el mes: ingresos, gastos, ahorro y tasa de ahorro.

Reglas que corrigen al modelo:

- El método de pago solo se guarda si aparece en el texto (Yappy, efectivo, tarjeta, transferencia). Los modelos pequeños tienden a inventarlo.
- Palabras como "quincena", "recibí" o "vendí" marcan un ingreso. "Ahorré" o "cuenta de ahorros" marcan ahorro.
- Palabras como "almuerzo", "luz", "taxi" o "alquiler" fijan la categoría de un gasto.
- Un monto que no aparece en el texto, como "ahorré la mitad", queda marcado para revisar.
- Retirar efectivo del cajero no crea una fila.

## Hoja de Salud: base instalada de equipos médicos

Un ingeniero de servicio o un vendedor sale de un hospital y dice: "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años."

La hoja guarda una fila por equipo con cliente, ciudad, país, modalidad, cantidad, marca, modelo, antigüedad y estado. La pantalla agrupa los equipos por cliente y resume toda la base: clientes, equipos por modalidad y equipos por renovar.

| Estado | Significado |
| --- | --- |
| Confirmado | El colaborador lo vio directamente. |
| Reportado | Alguien del hospital se lo dijo ("me dijo", "según"). |
| Estimado | Lo aproximó ("parece", "unos", "creo"). |
| Desconocido | No hay forma de saberlo. |

Además de la captura mínima, la hoja cubre las metas adicionales del reto:

- **Dictado por voz** al terminar la visita.
- **Duplicados.** Si dos visitas reportan el mismo equipo del mismo cliente, la app los une y cuenta las confirmaciones.
- **Confianza de 0 a 100.** Suma 15 puntos por marca, modelo, antigüedad y ubicación, 25, 15, 8 o 0 según el estado, y 15 con dos visitas distintas. Resta 20 si nadie lo verificó en 180 días.
- **Alertas.** "Sin verificar" marca equipos sin visita en 180 días.
- **Pregunta de seguimiento.** Tras cada captura, la app pregunta por el dato faltante más valioso, por ejemplo "¿De qué marca es el tomógrafo?". La respuesta se suma a la misma visita.
- **Renovación.** "Renovar" marca equipos de 8 años o más.

La app verifica cliente, ciudad, país, marca, modelo, cantidad y antigüedad contra el texto. En las pruebas, MedPsy escribió un "Aquilion" en un resonador Philips, un "Siemens Somatom" en un tomógrafo sin marca y una antigüedad de 7 años para un equipo "nuevo". La verificación borró los tres.

## Exportar a Google Sheets

1. Toca **Exportar a Google Sheets** en la hoja abierta.
2. En el menú de compartir de Android, elige Google Drive.
3. Abre `finanzas.csv` o `equipos.csv` con Google Sheets.

El CSV usa UTF-8 con BOM, comas como separador y comillas según RFC 4180. Con los datos de demostración, un lector CSV estándar lee `finanzas.csv` como 11 filas de 7 columnas y `equipos.csv` como 9 filas de 15 columnas, incluidas las celdas con saltos de línea.

## Modelos

| Uso | Modelo (constante de `@qvac/sdk`) | Cuantización | Tamaño |
| --- | --- | --- | --- |
| Voz a texto | Parakeet TDT 0.6B v3 de NVIDIA (`PARAKEET_TDT_0_6B_V3_Q4_0`) | Q4_0 | 399 MB |
| Hoja de Finanzas | Qwen3 1.7B Instruct (`QWEN3_1_7B_INST_Q4`) | Q4 | 1.06 GB |
| Hoja de Salud | MedPsy 1.7B (`HEALTHCARE_1_7B_MEDICAL_Q4_K_M`, repositorio `qvac/MedPsy-1.7B-GGUF`) | Q4_K_M | 1.28 GB |

La app carga solo el modelo de la hoja abierta y libera el otro al cambiar. La insignia **En el dispositivo** muestra estos nombres, la cuantización, el tamaño y el dispositivo.

### Por qué Parakeet

Sintetizamos una consulta de 48 segundos con dos voces (Supertonic 3 de QVAC) y la transcribimos con los dos modelos de voz para español:

| Modelo | Error por palabra | Tiempo de transcripción | Carga |
| --- | --- | --- | --- |
| Parakeet TDT 0.6B v3 Q4_0 | 0.22 | 6.7 s | 19.1 s, incluye la descarga |
| Whisper Tiny español Q8_0 | 0.50 | 1.1 s | 6.7 s |

Whisper omitió la mitad del audio. Parte del error de Parakeet es que escribe números con dígitos. Script, audio y resultados: `eval/probe/asr-probe.mjs`, `eval/probe/consulta-16k.wav`, `eval/probe/asr-results.jsonl`.

### Por qué MedPsy para Salud

Con el mismo prompt y el mismo JSON Schema sobre frases de equipos médicos, Llama 3.2 1B escribió "visto" como nombre del cliente y registró un Aquilion y un Ingenia como un angiógrafo. MedPsy 1.7B identificó hospital, ciudad y país, y generó entre 14.5 y 21.7 tokens por segundo contra 3.6 a 6.3 de Llama en el mismo equipo (`eval/probe/results.jsonl`). MedPsy también inventa modelos y a veces repite texto dentro de un campo. Por eso la app limita el largo de cada campo, le da un ejemplo resuelto y verifica cada valor contra el texto.

### Por qué Qwen3 para Finanzas

Con el mismo prompt, ejemplo y JSON Schema sobre seis frases de finanzas, MedPsy omitió el segundo movimiento en tres frases e inventó una fila. Qwen3 encontró todos los movimientos (`eval/probe/finance-probe.mjs`, `eval/probe/finance-results.jsonl`). Los dos inventaron métodos de pago, y de ahí salen las reglas de la hoja de Finanzas.

## Calidad medible

`scripts/eval-sheets.ts` corre el mismo prompt, el mismo ensamblado y la misma verificación que usa la app sobre casos sintéticos con respuesta esperada: 12 frases de equipos (`eval/equipos.json`) y 10 frases de finanzas (`eval/finanzas.json`, incluido un retiro de cajero que no debe crear fila).

```sh
bun scripts/eval-sheets.ts --sheet equipos
bun scripts/eval-sheets.ts --sheet finanzas
```

Cada corrida escribe `eval/runs/<hoja>-<modelo>.jsonl`, con la carga del modelo y, por caso, el prompt, los tokens de entrada y salida, el TTFT, los tokens por segundo, la salida cruda, el resultado verificado y los puntajes. También escribe un resumen en `eval/runs/<hoja>-<modelo>.md` que explica cada métrica.

## Rendimiento

La app escribe `perf-log.jsonl` en el teléfono con cada carga de modelo, transcripción y extracción: modelo, cuantización, prompt, tokens de entrada y salida, TTFT, tokens por segundo, backend (CPU o GPU), duración y dispositivo. Para exportarlo, toca **En el dispositivo** y luego **Compartir registro de rendimiento**.

Las corridas de `eval/runs/` son la referencia de escritorio: Intel Core Ultra 7 258V, 8 núcleos, 16 GB de RAM, Ubuntu en WSL2, backend CPU.

## Sin nube

- Toda la inferencia corre con `@qvac/sdk` en el dispositivo. La app no llama a ninguna API remota.
- La única conexión de red es la primera descarga de modelos desde el registro de QVAC, que usa Hyperswarm (P2P).
- Las hojas se guardan en archivos JSON dentro del almacenamiento privado de la app.

## Ejecutar en Android

QVAC publica binarios nativos solo para `arm64-v8a`. Un emulador x86_64 no puede cargar los modelos. La demo real necesita un teléfono Android arm64 con Android 10 (API 29) o superior y unos 3 GB libres.

```sh
bun install
npx expo prebuild
npx expo run:android --device
```

La primera vez que abres cada hoja, la app descarga su modelo. Después funciona en modo avión.

Para revisar solo la interfaz en un emulador, con datos de demostración y sin modelos:

```sh
EXPO_PUBLIC_UI_ONLY=true bun run android
```

Pruebas:

```sh
bun test src
bunx tsc --noEmit
```

## Limitaciones

- Solo probamos español.
- Los casos de evaluación son sintéticos. No usamos datos reales de clientes bancarios ni de hospitales.
- La extracción puede equivocarse u omitir datos. Cada fila guarda el texto original y marca lo que no pudo verificar.
- Las cifras de escritorio no son las del teléfono. Las del teléfono salen del registro de rendimiento.

## Base preexistente

Declarada según las reglas del hackathon.

- Plantilla de `create-expo-app` en TypeScript: `app.json`, `index.ts`, configuración de Babel, Metro, Tailwind y NativeWind, y la licencia MIT de 650 Industries. Las imágenes originales de la plantilla quedan en `assets/brand/expo-template-originals`.
- El commit inicial `69d733d` (un asistente de voz con Whisper y Llama 3.2 1B, y los scripts `scripts/launch-android.ts` y `scripts/verify-android.ts`) lo generamos con asistentes de IA durante el hackathon, sobre la plantilla de Expo y siguiendo la documentación del SDK de QVAC. Lo declaramos porque es la base sobre la que empezamos.
- `.claude/skills/`, `.agents/skills/` y `skills-lock.json`, skills de terceros para asistentes de programación. No forman parte de la app.
- Usamos asistentes de programación con IA (Codex y Claude Code), que las reglas permiten.

El historial muestra cómo evolucionó la idea durante el hackathon: voz a hoja de cálculo, modos de finanzas y salud, una base instalada de equipos médicos, una nota clínica y, al final, estas dos plantillas.

## Componentes de terceros

| Componente | Licencia | Uso |
| --- | --- | --- |
| `@qvac/sdk` | Apache-2.0 | Carga de modelos, transcripción y extracción en el dispositivo |
| Expo y React Native | MIT | App móvil |
| `expo-audio` | MIT | Grabación del micrófono |
| `expo-file-system` | MIT | Almacenamiento local |
| `expo-sharing` | MIT | Exportar CSV y el registro de rendimiento |
| `expo-device` | MIT | Nombre del dispositivo en el registro de rendimiento |
| NativeWind y Tailwind CSS | MIT | Estilos |

No hay APIs remotas.

## Licencia

MIT. Ver `LICENSE`.
