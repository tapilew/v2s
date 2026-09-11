# Guion de demo

Un video de 4:30. Tesis: cualquiera crea una hoja de cálculo nueva hablando, sin plantilla, y la abre en Excel o Google Sheets. Lo demás son casos de uso.

| Jurado | Qué tiene que ver | Dónde |
| --- | --- | --- |
| General | Problema real resuelto de punta a punta, sin nube, con algo nuevo | Todo |
| Caja de Ahorros | La hoja como complemento de la banca en línea | 0:20 a 2:15 |
| Philips | Captura por voz, extracción, dataset con varios clientes | 2:15 a 3:50 |
| Tether QVAC Psy | MedPsy en el flujo principal, registro de rendimiento, límites dichos | 2:15 a 4:10 |

Pixel 9 Pro, build 4 o posterior. Modo avión desde el segundo 0 hasta el 3:25.

## Antes de grabar

- Instala Excel y Google Sheets, inicia sesión en Google, abre un CSV de prueba en cada una.
- Abre Finanzas y Salud con red para descargar los tres modelos (2.7 GB).
- Crea las tres hojas pre-hechas con la app. Genera y borra una hoja de prueba para que Qwen3 quede cargado.
- Modo avión. Batería arriba del 50 %. Ensaya cada frase dos veces.
- En edición, corta las esperas y deja un segundo de cada barra de progreso.

## Hojas pre-hechas

Se generan con la app, una frase por sesión. Celdas mal generadas se corrigen a mano. En cámara se dice: "estas hojas las creé con la app durante la semana". Hospitales ficticios; las frases de `eval/equipos.json` con hospitales reales no se usan.

### Ahorro navideño (Finanzas)

1. "El 15 de agosto deposité 100 en el plan de ahorro navideño, en efectivo en la sucursal."
2. "El 29 de agosto pasé 100 más al ahorro navideño por transferencia."
3. "El 5 de septiembre deposité 100 al ahorro navideño por transferencia."

| Fecha | Concepto | Tipo | Categoría | Monto | Método |
| --- | --- | --- | --- | --- | --- |
| 2026-08-15 | Ahorro navideño | Ahorro | Ahorro | 100 | Efectivo |
| 2026-08-29 | Ahorro navideño | Ahorro | Ahorro | 100 | Transferencia |
| 2026-09-05 | Ahorro navideño | Ahorro | Ahorro | 100 | Transferencia |

Corrige las fechas a mano. Pie: "Ahorro 300". Si no salió columna Tipo, borra y repite.

### Base instalada (Salud)

1. "Hospital San Lucas del Valle, en David, Chiriquí. Hay un tomógrafo de dieciséis cortes, creo que Toshiba, más o menos de 2012."
2. "Clínica Monteverde, San José, Costa Rica. Una gammacámara GE Discovery y dos ecógrafos Philips EPIQ que compraron el año pasado."
3. "Hospital Central del Norte, Quito, Ecuador. Me contaron que tienen un resonador pero no pude entrar a verlo."
4. "Centro de Imágenes Altavista, Guatemala. Un tomógrafo Siemens Somatom de unos seis años y un equipo de rayos X Fujifilm."

| Cliente | Modalidad | Cantidad | Marca | Antigüedad | Estado |
| --- | --- | --- | --- | --- | --- |
| Hospital San Lucas del Valle | Tomografía | 1 | Toshiba | 2012 | Estimado |
| Clínica Monteverde | Medicina nuclear | 1 | GE Discovery | | Confirmado |
| Clínica Monteverde | Ultrasonido | 2 | Philips EPIQ | 1 | Confirmado |
| Hospital Central del Norte | Resonancia magnética | 1 | | | Reportado |
| Centro de Imágenes Altavista | Tomografía | 1 | Siemens Somatom | 6 | Estimado |
| Centro de Imágenes Altavista | Radiografía | 1 | Fujifilm | | Confirmado |

Revisa Estado a mano: "creo que" y "unos" son Estimado, "me contaron" es Reportado. Renombra a "Base instalada".

### Presión y glucosa (Salud)

1. "Hoy en la mañana la presión me salió 130 sobre 85 y la glucosa 98."
2. "Anoche la presión estaba en 128 sobre 82."
3. "Hoy la glucosa en ayunas fue 102 y la presión 132 sobre 86."

| Fecha | Presión sistólica | Presión diastólica | Glucosa |
| --- | --- | --- | --- |
| 2026-09-08 | 130 | 85 | 98 |
| 2026-09-09 | 128 | 82 | |
| 2026-09-10 | 132 | 86 | 102 |

Corrige fechas. Las columnas las elige el modelo; no se corrige el esquema. Solo se muestra al cierre.

## Guion

En Finanzas se dice "tarjeta" y "efectivo", no "Yappy". Es la demo para un banco.

### 0:00 · Apertura

Mis hojas con las tres hojas, avión visible.

> Esto es V2S, voice to spreadsheet. Le hablas al teléfono y te devuelve una hoja de cálculo. Sin plantilla ni formulario: el modelo decide título y columnas, y la hoja se abre en Excel o Google Sheets. Miren el modo avión. Todo corre en este teléfono con el SDK de QVAC. Estas tres hojas las creé con la app durante la semana. Ahora hago una nueva.

### 0:20 · Hoja nueva por voz

Finanzas. **Dictar**, frase, **Detener y transcribir**. Destino **Nueva hoja**, **Crear hoja**.

> Hoy pagué 45 dólares de luz con tarjeta y 12 de almuerzo en efectivo. Me cayó la quincena, 850, y pasé 100 a la cuenta de ahorros.

Mientras procesa:

> Parakeet transcribe en el teléfono, sin señal ni teclado. No definí columnas. Qwen3, 1.7 mil millones de parámetros a 4 bits, arma título, columnas y filas.

### 0:55 · Junto al estado de cuenta

Hoja Movimientos, cuatro filas. Pie: "Ingresos 850 · Gastos 57 · Ahorro 100". Si hay celda **Revisar** o un método inventado, tócalo y corrígelo.

> El banco ve la quincena de 850 y la transferencia de 100. El almuerzo de 12 en efectivo no existe para el banco. La hoja sí lo tiene. Una ve lo que pasa por el banco, la otra ve el resto. Y la app compara cada número contra lo que dije: si el modelo inventa uno, la celda queda marcada. Aquí puso un método que no dije. Toco, corrijo, listo.

### 1:30 · Sumar a una meta

Escribe por texto. Destino **Ahorro navideño**, **Agregar a la hoja**.

> Hoy deposité 75 al ahorro navideño, en efectivo en la sucursal.

> Esta hoja la vengo llenando desde agosto. El modelo respeta sus columnas y suma la fila. Ahorro 375. La meta con nombre y el depósito en efectivo: lo que una caja de ahorros quiere ver y nunca le llega.

### 1:55 · Excel

Vuelve a Movimientos, **Exportar**, Excel. Se ve la hoja abierta.

> Esta hoja no existía hace un minuto y ya está en Excel, con el teléfono en modo avión. No está integrado con la banca en línea a propósito: el dato es del cliente. Si el banco lo quiere en su app o en una tableta de sucursal, el modelo ya corre en el teléfono y el banco nunca custodia ese dato.

### 2:15 · Philips con MedPsy

Salud. Destino **Base instalada**. **Dictar**, frase, **Agregar a la hoja**.

> Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.

Mientras procesa:

> Salud carga MedPsy, el modelo médico de QVAC. Esto es el reto de Philips: el ingeniero sale de la visita y dice lo que vio, en el estacionamiento, sin señal, sin formulario.

Dos filas nuevas al final. Señala Antigüedad y Estado.

> "Unos ocho años" quedó como 8, Estimado. Del tomógrafo no dije marca ni edad y las celdas quedaron vacías, no inventadas. MedPsy tiene una regla dura: nunca agrega valores que no se dijeron.

### 2:55 · Cinco clientes, un dataset

Sube por la hoja. Mantén presionada la fila de Hospital Central del Norte, **Ver texto original**.

> Cinco hospitales en cuatro países, una hoja. Confirmado, Estimado, Reportado. Esta fila dice Reportado porque el texto original dice "me contaron". Cada fila guarda cuándo se dijo y con qué palabras.

### 3:25 · Google Sheets

**Exportar**, Google Sheets. Quita el modo avión en cámara si lo pide.

> Quito el modo avión ahora porque la inferencia ya terminó. Lo único que necesita red es Sheets. Aquí va la tabla dinámica por modalidad y el reporte de equipos con más de siete años. El dashboard no está en la app; lo que está en la app es la parte difícil.

### 3:50 · Registro de rendimiento

**En el dispositivo**. Muestra los modelos y **Compartir registro de rendimiento**.

> Parakeet, Qwen3 y MedPsy con su cuantización. La app carga solo el modelo del modo abierto. Cada carga y generación queda en un registro con prompt, tokens, tiempo al primer token y tokens por segundo. Los casos de evaluación están en el repositorio. Todo sintético.

### 4:10 · Cierre

Mis hojas, cuatro hojas. Abre Presión y glucosa dos segundos.

> Cuatro hojas, dos modelos, ninguna plantilla. Esta es la presión y la glucosa de un paciente, dictadas igual que el inventario de un hospital. No diagnostica nada; es el registro que lleva a su consulta. El modelo corre aquí y el dato se queda aquí. Eso es V2S.

## Marcas de tiempo

```text
0:00 Apertura, modo avión
0:20 Caja de Ahorros: hoja nueva por voz, junto a la banca en línea
1:55 La hoja abierta en Excel
2:15 Philips y QVAC Psy: base instalada dictada con MedPsy
3:25 El dataset abierto en Google Sheets
3:50 Modelos y registro de rendimiento
4:10 Registro personal de salud y cierre
```

## Si algo falla

- **Transcripción mal.** Corrige en el cuadro y sigue.
- **Hoja nueva sin columna Tipo.** Borra y repite.
- **MedPsy juntó equipos o confundió modalidad.** Edita en cámara y di que la verificación solo cubre números. Está en el README.
- **Excel o Sheets no aparecen al compartir.** Comparte a Drive y ábrelo desde ahí. Pruébalo antes.
- **La app se cierra al abrir.** FB-001, corregida en build 4.

## Entrega

- Menos de cinco minutos, enlace sin credenciales, antes del 11 de septiembre a las 8:00 de Panamá.
- Datos sintéticos, dicho en el video y en la descripción.
- El README ya declara la base preexistente. No borrar esa sección.
- Adjuntar el `perf-log.jsonl` exportado de la sesión de grabación.
- Si preguntan por qué MedPsy y no Qwen3 para equipos: Qwen3 recuerda más valores (84 % contra 59 %), MedPsy inventa menos números (94 % con respaldo contra 83 %). Detalle en `eval/runs`.
