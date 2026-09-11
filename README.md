![V2S](assets/brand/v2s-logo-horizontal.png)

# V2S

Habla o escribe, y el teléfono lo convierte en una hoja de cálculo. Cada grabación o texto crea una hoja nueva con sus propias columnas, o agrega filas a una hoja que ya guardaste. Las hojas viven en la app y se exportan a Excel Google Sheets con un click. Toda la IA corre en el teléfono con el SDK de QVAC. Totalmente confidencial.

Los casos de uso son **Finanzas** y **Salud**. Sirve como asesor de ahorro, para el registro de equipos médicos de un hospital o para cualquier otra cosa que quieras convertir en filas.

[Tracks](https://www.trydojo.io/hackathons/decentralized-ai-hackathon?tab=tracks): Desafío General, Reto Caja de Ahorros, Reto Philips (Inteligencia de Base Instalada de Clientes) y Reto Tether QVAC Psy.

## Cómo funciona

1. Elige el modo con el selector de arriba.
2. Escribe en el cuadro o toca el micrófono. Parakeet transcribe en el teléfono y deja el texto en el cuadro.
3. Elige el destino: **Nueva hoja** o una de tus hojas guardadas.
4. Toca **Crear hoja** o **Agregar a la hoja**.
5. El modelo del modo propone título, columnas y filas para una hoja nueva, o filas con las columnas de la hoja elegida.
6. La app verifica cada número contra tu texto y marca con **Revisar** las celdas que no pudo respaldar.
7. Edita celdas, renombra la hoja y toca **Exportar** para abrir en Excel o Google Sheets.

## Modos

| Modo | Modelo (constante de `@qvac/sdk`) | Cuantización | Tamaño | Reglas del arnés |
| --- | --- | --- | --- | --- |
| Finanzas | Qwen3 1.7B Instruct (`QWEN3_1_7B_INST_Q4`) | Q4 | 1.06 GB | Sugiere columnas de dinero (fecha, concepto, tipo, categoría, monto, método), montos como números |
| Salud | MedPsy 1.7B (`HEALTHCARE_1_7B_MEDICAL_Q4_K_M`) | Q4_K_M | 1.28 GB | Vocabulario clínico y de equipos médicos; nunca agrega diagnósticos, dosis ni valores que no se dijeron |
| Voz a texto (ambos) | Parakeet TDT 0.6B v3 (`PARAKEET_TDT_0_6B_V3_Q4_0`) | Q4_0 | 399 MB | |

Los dos arneses comparten las mismas reglas base: una fila por cosa dicha, celdas vacías cuando falta un dato, nunca inventar números, fechas AAAA-MM-DD, un ejemplo resuelto y salida restringida por JSON Schema. La app carga solo el modelo del modo abierto.

### Finanzas (Qwen3 1.7B)

Texto: "Ayer compré útiles escolares por 38.50 y el taxi fue 6."

Hoja generada: **Movimientos**

| Fecha | Concepto | Tipo | Categoría | Monto | Método |
| --- | --- | --- | --- | --- | --- |
| 2026-09-09 | Útiles escolares | Gasto | Educación | 38.5 | Tarjeta |
| 2026-09-09 | Taxi | Gasto | Transporte | 6 | Tarjeta |

"Ayer" se convirtió en la fecha correcta y las categorías son las esperadas. El método "Tarjeta" no se dijo: el modelo lo inventó. Por eso cada celda se edita antes de exportar.

### Salud (MedPsy 1.7B)

Texto: "Centro de Imágenes Diagnósticas en Guatemala. Tienen un tomógrafo Siemens Somatom de unos seis años y un equipo de rayos X Fujifilm."

Hoja generada: **Centro de Imágenes Diagnósticas en Guat**

| Cliente | Modalidad | Cantidad | Marca | Antigüedad | Estado |
| --- | --- | --- | --- | --- | --- |
| Centro de Imágenes Diagnósticas en Guat | Tomografía | 1 | Siemens | 6 | Estimado |
| Centro de Imágenes Diagnósticas en Guat | Radiografía | 1 | Fujifilm | 1 | Estimado |

Modalidad, marca y estado "Estimado" (por "unos seis años") son correctos. El nombre del cliente quedó cortado por el límite de largo del campo, y la antigüedad "1" del equipo de rayos X no se dijo, así que la app la marca para revisar.

## Sin nube

- Toda la inferencia corre con `@qvac/sdk` en el dispositivo. No hay llamadas a APIs remotas.
- La única conexión de red es la primera descarga de modelos desde el registro de QVAC, que usa Hyperswarm (P2P).
- Las hojas se guardan en archivos JSON dentro del almacenamiento privado de la app.

## Instalar en un teléfono (sin compilar)

[**Descargar el APK oficial**](https://github.com/tapilew/v2s/releases/latest/download/v2s.apk) · [Ver la release](https://github.com/tapilew/v2s/releases/latest)

Android 10 o superior, con sistema ARM64. Empieza por la [guía corta de instalación y primera prueba](docs/INSTALAR-ANDROID.md). Si falla, comparte la [guía de diagnóstico para agentes](docs/DIAGNOSTICO-ANDROID.md). No necesitas Expo Go para usar el APK.

## Ejecutar en Android

Para compilar localmente:

```sh
bun install
npx expo prebuild
npx expo run:android --device
```

La primera vez que abres cada modo, la app descarga su modelo. Después funciona en modo avión.

## Limitaciones

- Los casos de evaluación son sintéticos. No usamos datos reales de clientes bancarios, pacientes ni hospitales.
- En las corridas, Qwen3 a veces inventó métodos de pago o tomó un ingreso como gasto, y MedPsy a veces confundió modalidades, unió dos equipos en una fila o inventó un estado. La verificación marca los números sin respaldo, pero no detecta una categoría o una modalidad equivocada.
- El modelo puede omitir datos o elegir columnas distintas a las que esperabas. Cada fila guarda el texto original y las celdas se editan.


## Código open source usado

- Plantilla de `create-expo-app` en TypeScript: `app.json`, `index.ts`, configuración de Babel, Metro, Tailwind y NativeWind, y la licencia MIT de 650 Industries. Las imágenes originales de la plantilla quedan en `assets/brand/expo-template-originals`.
- `.claude/skills/`, `.agents/skills/` y `skills-lock.json`, skills de terceros para asistentes de programación. No forman parte de la app.
- `@qvac/sdk` (Apache-2.0): Carga de modelos, transcripción y generación en el dispositivo
- Expo y React Native (MIT): App móvil
- `expo-audio` (MIT): Grabación del micrófono
- `expo-file-system` (MIT): Almacenamiento local
- `expo-sharing` (MIT): Exportar CSV y el registro de rendimiento
- `expo-device` (MIT): Nombre del dispositivo en el registro de rendimiento
- NativeWind y Tailwind CSS (MIT): Estilos

sin apis remotas. totalmente local y confidencial.

## Licencia

MIT. Ver `LICENSE`.
