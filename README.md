# Base Instalada

Después de visitar un hospital, el colaborador de campo dice en voz alta qué equipos vio. El teléfono transcribe el audio y extrae cliente, ciudad, país, modalidad, cantidad, marca, modelo, antigüedad y estado. Después lo guarda como base instalada por cliente. Toda la inferencia corre en el teléfono con el SDK de QVAC. El audio y las observaciones no salen del dispositivo, y la app funciona en modo avión después de la primera descarga de modelos.

Tracks: Reto corporativo Philips (Inteligencia de Base Instalada de Clientes), Reto Tether QVAC Psy y Desafío General.

## Qué hace

1. Toca el micrófono y di lo que viste: "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años." Si no puedes hablar en voz alta, escríbelo.
2. Whisper transcribe el audio en el teléfono.
3. MedPsy 1.7B extrae la observación. La salida está restringida por un JSON Schema, así que la modalidad y el estado siempre son valores válidos.
4. La app guarda tus palabras en disco antes de extraer. Si el modelo falla, lo que dijiste no se pierde y puedes reintentar.
5. Si falta el dato más valioso, la app pregunta por él ("¿De qué marca es el tomógrafo?"). La respuesta se suma a la misma visita y la visita se vuelve a extraer. Puedes omitir la pregunta.
6. La vista agrupa los equipos por cliente, une duplicados entre visitas, marca los equipos con 8 años o más para renovación y los datos sin verificar en 180 días.
7. El botón de compartir exporta la base instalada como CSV.

## Estados y confianza

| Estado | Significado |
| --- | --- |
| Confirmado | El colaborador lo vio directamente. |
| Reportado | Alguien del hospital se lo dijo. |
| Estimado | Lo aproximó ("parece", "unos", "creo"). |
| Desconocido | No hay forma de saberlo. |

La confianza va de 0 a 100. Suma 15 puntos por cada dato presente (marca, modelo, antigüedad y ubicación), 25, 15, 8 o 0 según el estado, y 15 si dos visitas distintas reportan el mismo equipo. Resta 20 si nadie lo verificó en 180 días. Al tocar un equipo, la app muestra cada factor. Las reglas viven en `src/installed-base.ts` y sus pruebas en `src/installed-base.test.ts`.

## Modelos

| Uso | Modelo (constante de `@qvac/sdk`) | Cuantización | Tamaño |
| --- | --- | --- | --- |
| Voz a texto | Whisper Tiny en español (`WHISPER_SPANISH_TINY_Q8_0`) | Q8_0 | ~45 MB |
| Extracción | MedPsy 1.7B (`HEALTHCARE_1_7B_MEDICAL_Q4_K_M`) | Q4_K_M | 1.28 GB |

La app muestra estos nombres, la cuantización y el dispositivo al tocar la insignia "En el dispositivo".

### Por qué MedPsy

Comparamos MedPsy 1.7B con Llama 3.2 1B Instruct (`LLAMA_3_2_1B_INST_Q4_0`) con el mismo prompt y el mismo JSON Schema. Llama puso "visto" como nombre del cliente en las dos frases de prueba. En la segunda también usó "visto" como país, tomó "Paitilla" como ciudad y registró un Aquilion y un Ingenia como un solo angiógrafo. MedPsy identificó el hospital, la ciudad y el país de la primera frase. En el mismo equipo, MedPsy generó entre 14.5 y 21.7 tokens por segundo y Llama entre 3.6 y 6.3. Los resultados completos están en `eval/probe/results.jsonl`.

MedPsy todavía comete errores. En las pruebas inventó un modelo ("Achieva") y en una frase repitió texto hasta el límite de tokens. Por eso la app guarda siempre las palabras originales, permite deshacer y marca cada dato con su estado.

## Rendimiento

La app escribe un registro JSONL en el teléfono (`perf-log.jsonl`) con cada carga de modelo, transcripción y extracción: modelo, cuantización, prompt, tokens de entrada y salida, TTFT, tokens por segundo, backend (CPU o GPU) y dispositivo. Para exportarlo, toca "En el dispositivo" y luego "Compartir registro de rendimiento".

Medición de referencia en escritorio, con `eval/probe/probe.mjs`, sin GPU:

| Modelo | Carga | Prompt / generados | TTFT | Tokens/s | Tiempo total |
| --- | --- | --- | --- | --- | --- |
| MedPsy 1.7B Q4_K_M | 75.0 s, incluye la descarga de 1.28 GB | 167 / 89 | 1356 ms | 14.5 | 8.1 s |
| Llama 3.2 1B Q4_0 | 7.1 s, desde caché | 162 / 101 | 1152 ms | 6.3 | 18.3 s |

Equipo de la medición: Intel Core Ultra 7 258V, 8 núcleos, 16 GB de RAM, Ubuntu en WSL2, backend CPU.

Para reproducir la comparación:

```sh
bun install
node eval/probe/probe.mjs llama1b
node eval/probe/probe.mjs medpsy17
```

## Sin nube

- Toda la inferencia corre con `@qvac/sdk` en el dispositivo. La app no llama a ninguna API de inferencia remota.
- La única conexión de red es la primera descarga de modelos desde el registro de QVAC, que usa Hyperswarm (P2P). Después, la app funciona sin conexión.
- Las visitas se guardan en `visits.json`, dentro del almacenamiento privado de la app.

## Ejecutar en Android

QVAC publica binarios nativos solo para `arm64-v8a`. Un emulador x86_64 no puede cargar los modelos. La demo real necesita un teléfono Android arm64 con Android 10 (API 29) o superior y unos 2 GB libres.

```sh
bun install
npx expo prebuild
npx expo run:android --device
```

La primera vez, la app descarga unos 1.3 GB de modelos. Después funciona en modo avión.

Para revisar solo la interfaz en un emulador, sin modelos y con datos de demostración:

```sh
EXPO_PUBLIC_UI_ONLY=true bun run android
```

Pruebas y verificaciones:

```sh
bun test src
bunx tsc --noEmit
bun run verify
```

## Limitaciones

- La app registra equipos instalados. No da información clínica ni diagnósticos.
- La extracción puede equivocarse o inventar un modelo. Cada dato lleva su estado y la frase original queda guardada para revisarla.
- Solo probamos español.
- Las cifras de rendimiento de arriba son de escritorio. Las del teléfono salen del registro de rendimiento de la app.

## Base preexistente

Declarada según las reglas del hackathon.

- Plantilla de `create-expo-app` en TypeScript: `app.json`, `index.ts`, `assets/`, configuración de Babel, Metro, Tailwind y NativeWind, y la licencia MIT de 650 Industries.
- Ejemplo de asistente de voz local con QVAC (Whisper en español y Llama 3.2 1B para conversar), usado como punto de partida en el commit `69d733d`.
- `scripts/launch-android.ts` y `scripts/verify-android.ts`, utilidades para lanzar Android desde WSL, incluidas en el mismo commit.
- `.claude/skills/`, `.agents/skills/` y `skills-lock.json`, skills de terceros para asistentes de programación. No forman parte de la app.
- Usamos asistentes de programación con IA (Codex y Claude Code), que las reglas permiten.

El resto del trabajo se hizo durante las 48 horas del hackathon, a partir del commit `c3ce9ee`.

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
