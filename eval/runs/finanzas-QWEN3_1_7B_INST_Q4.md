# Corrida de evaluación: finanzas, modo finanzas, QWEN3_1_7B_INST_Q4

## Host y carga

cpu es `Intel(R) Core(TM) Ultra 7 258V` con 8 núcleos y 15.4 GB de memoria, corriendo linux 6.6.87.2-microsoft-standard-WSL2.
La carga del modelo tomó 4971 ms.
Versión del SDK `0.19.0`, iniciada en 2026-09-11T02:27:57.276Z.

## Métricas

| Métrica | Valor |
| --- | --- |
| Filas generadas / esperadas (total) | 16 / 15 |
| Recall de filas (mediana) | 100.0% |
| Sobregeneración de filas (total) | 1 |
| Recall de valores clave | 91.2% (31/34) |
| Fundamentación numérica, salida cruda | 100.0% |
| Fundamentación numérica, tras ensamblar | 100.0% |
| Columnas por hoja (promedio) | 6.0 |
| Encabezado con concepto numérico | 100.0% |

## Cómo se puntúa

**Filas.** Cada caso trae un número de filas esperado: una por movimiento en Finanzas, una por equipo en Equipos, y en Consultas una fila de paciente más una por medicamento indicado. El recall de filas es el mínimo entre las filas generadas y las esperadas, dividido entre las esperadas; un caso que genera de más no sube el recall pero sí cuenta como sobregeneración (filas generadas de más allá de las esperadas), sumada en todos los casos.

**Recall de valores clave.** La hoja no tiene columnas fijas, así que en vez de comparar campo por campo se busca cada dato esperado en cualquier celda de la hoja generada: en Finanzas, cada monto y cada palabra de cuatro letras o más del concepto; en Equipos, cada marca, modelo, cantidad y antigüedad; en Consultas, el nombre del paciente, cada número de un signo vital, y cada medicamento con el número de su dosis. Los números exigen coincidencia exacta después de normalizar comas decimales; el texto cuenta como encontrado si aparece, sin tildes ni mayúsculas, dentro de alguna celda de texto generada.

**Fundamentación.** Mide qué proporción de las celdas numéricas tiene sus dígitos presentes en el texto de origen. La tasa 'salida cruda' se calcula sobre la respuesta JSON de la llamada de filas antes de cualquier filtro; la tasa 'tras ensamblar' usa las marcas `unverified` que el propio ensamblado calcula. Ambas deberían acercarse al 100%, porque el ensamblado ya descarta o marca lo que el texto no respalda.

**Columnas.** Se cuentan las columnas de cada hoja generada y se revisa si al menos un encabezado nombra un concepto que lleva número (monto, cantidad, dosis, temperatura, antigüedad, precio o total) en los casos donde el conjunto esperado sí tiene números; una hoja de Finanzas sin ninguna columna de monto, por ejemplo, reprueba esta métrica aunque sus filas luzcan razonables.

## Rendimiento

**Llamada de lista.** TTFT mediano 1405 ms (p90 1614 ms), velocidad mediana 30.9 tok/s, tiempo de pared mediano 2271 ms (p90 4683 ms). Tokens de entrada: 1925. Tokens generados: 213.

**Llamada de filas.** TTFT mediano 2772 ms (p90 3272 ms), velocidad mediana 27.9 tok/s, tiempo de pared mediano 6152 ms (p90 7759 ms). Tokens de entrada: 3751. Tokens generados: 796.

**Total por caso.** Tiempo de pared mediano 8449 ms, p90 12224 ms.
