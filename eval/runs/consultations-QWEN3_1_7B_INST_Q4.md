# Corrida de evaluación: consultations, modo salud, QWEN3_1_7B_INST_Q4

## Host y carga

cpu es `Intel(R) Core(TM) Ultra 7 258V` con 8 núcleos y 15.4 GB de memoria, corriendo linux 6.6.87.2-microsoft-standard-WSL2.
La carga del modelo tomó 5120 ms.
Versión del SDK `0.19.0`, iniciada en 2026-09-11T02:50:18.658Z.

## Métricas

| Métrica | Valor |
| --- | --- |
| Filas generadas / esperadas (total) | 17 / 22 |
| Recall de filas (mediana) | 41.7% |
| Sobregeneración de filas (total) | 6 |
| Recall de valores clave | 28.3% (15/53) |
| Fundamentación numérica, salida cruda | 69.0% |
| Fundamentación numérica, tras ensamblar | 66.7% |
| Columnas por hoja (promedio) | 5.6 |
| Encabezado con concepto numérico | 50.0% |

## Cómo se puntúa

**Filas.** Cada caso trae un número de filas esperado: una por movimiento en Finanzas, una por equipo en Equipos, y en Consultas una fila de paciente más una por medicamento indicado. El recall de filas es el mínimo entre las filas generadas y las esperadas, dividido entre las esperadas; un caso que genera de más no sube el recall pero sí cuenta como sobregeneración (filas generadas de más allá de las esperadas), sumada en todos los casos.

**Recall de valores clave.** La hoja no tiene columnas fijas, así que en vez de comparar campo por campo se busca cada dato esperado en cualquier celda de la hoja generada: en Finanzas, cada monto y cada palabra de cuatro letras o más del concepto; en Equipos, cada marca, modelo, cantidad y antigüedad; en Consultas, el nombre del paciente, cada número de un signo vital, y cada medicamento con el número de su dosis. Los números exigen coincidencia exacta después de normalizar comas decimales; el texto cuenta como encontrado si aparece, sin tildes ni mayúsculas, dentro de alguna celda de texto generada.

**Fundamentación.** Mide qué proporción de las celdas numéricas tiene sus dígitos presentes en el texto de origen. La tasa 'salida cruda' se calcula sobre la respuesta JSON de la llamada de filas antes de cualquier filtro; la tasa 'tras ensamblar' usa las marcas `unverified` que el propio ensamblado calcula. Ambas deberían acercarse al 100%, porque el ensamblado ya descarta o marca lo que el texto no respalda.

**Columnas.** Se cuentan las columnas de cada hoja generada y se revisa si al menos un encabezado nombra un concepto que lleva número (monto, cantidad, dosis, temperatura, antigüedad, precio o total) en los casos donde el conjunto esperado sí tiene números; una hoja de Finanzas sin ninguna columna de monto, por ejemplo, reprueba esta métrica aunque sus filas luzcan razonables.

## Rendimiento

**Llamada de lista.** TTFT mediano 2297 ms (p90 3026 ms), velocidad mediana 33.4 tok/s, tiempo de pared mediano 6414 ms (p90 12878 ms). Tokens de entrada: 3263. Tokens generados: 1025.

**Llamada de filas.** TTFT mediano 3856 ms (p90 5585 ms), velocidad mediana 26.8 tok/s, tiempo de pared mediano 11337 ms (p90 35242 ms). Tokens de entrada: 5293. Tokens generados: 2658.

**Total por caso.** Tiempo de pared mediano 19949 ms, p90 55722 ms.
