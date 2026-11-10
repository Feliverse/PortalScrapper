# PortalScrapper DataX

Aplicación para consultar los datasets publicados en DataX Bolivia, comparar
snapshots históricos y supervisar su estado de actualización desde un dashboard
React.

## Arquitectura

```text
PortalScrapper/
├── server.py                  # API local y servidor del dashboard compilado
├── frontend/                  # Aplicación React + Vite
├── v2/
│   ├── PortalScrapper.py      # Scraper y comparación histórica
│   ├── productos_datax_dataset.csv
│   ├── historial_productos/   # Snapshots CSV
│   └── comparacion_*.xlsx     # Reportes de comparación
└── scrapper.py                # Versión anterior basada en Selenium
```

El flujo recomendado utiliza `v2/PortalScrapper.py`. La versión raíz
`scrapper.py` se conserva por compatibilidad y no es necesaria para el
dashboard.

## Requisitos

- Windows 10 o superior
- Python 3.10+
- Node.js 18+
- npm

## Instalación inicial

Desde PowerShell:

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper"

# Activar el entorno virtual existente
.\.venv\Scripts\Activate.ps1

# Dependencias Python
python -m pip install requests openpyxl

# Dependencias y build del frontend
cd frontend
npm.cmd install
npm.cmd run build
```

Si PowerShell bloquea `npm`, utilizar `npm.cmd` en lugar de `npm`.

## Arrancar la aplicación

### Modo integrado

Este modo sirve el frontend compilado y la API desde el mismo puerto:

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper"
.\.venv\Scripts\Activate.ps1
python server.py
```

Abrir [http://localhost:8000](http://localhost:8000).

### Modo desarrollo

Terminal 1, API Python:

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper"
.\.venv\Scripts\Activate.ps1
python server.py
```

Terminal 2, frontend Vite:

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper\frontend"
npm.cmd run dev
```

Abrir [http://localhost:5173](http://localhost:5173). La API debe seguir
ejecutándose en `http://localhost:8000`, porque Vite redirige allí las rutas
`/api` y `/downloads`.

## Funcionalidades del dashboard

- Ejecutar el scraper v2.
- Consultar el CSV principal sin importar manualmente los datos.
- Ver el total de datasets y el estado de cada uno.
- Filtrar por estado de actualización.
- Buscar por nombre del dataset o institución.
- Descargar el CSV principal.
- Descargar snapshots históricos.
- Descargar el último reporte comparativo.
- Convertir el CSV actual a un archivo Excel descargable.

## Reglas de monitoreo

El estado se calcula en `v2/PortalScrapper.py` comparando la fecha publicada
con la periodicidad del dataset:

| Estado | Regla |
|---|---|
| `Al día` | Han transcurrido menos del 80% del ciclo esperado |
| `Próximo a vencer` | Ha transcurrido entre el 80% y el 100% del ciclo |
| `Atrasado` | Se superó el ciclo esperado |
| `Sin fecha` | No existe una fecha válida |
| `Periodicidad no reconocida` | No existe una regla para la periodicidad |

Periodicidades configuradas: diaria, semanal, mensual, bimestral, trimestral,
cuatrimestral, semestral y anual.

## API local

El servidor definido en `server.py` expone:

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/status` | Estado, métricas, filas del CSV y archivos disponibles |
| `POST` | `/api/run-v2` | Ejecuta `v2/PortalScrapper.py` |
| `POST` | `/api/convert-excel` | Convierte el CSV actual a Excel |
| `GET` | `/downloads/<archivo>` | Descarga un archivo generado |

Ejemplo:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8000/api/status
```

## Ejecución manual de la v2

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper\v2"
python PortalScrapper.py
```

La ejecución genera:

- `productos_datax_dataset.csv`
- `historial_productos/productos_YYYYMMDD_HHMMSS.csv`
- `comparacion_productos_YYYYMMDD_HHMMSS.xlsx`

La comparación utiliza el campo `ID` como identificador único.

## Solución de problemas

### `npm error ... package.json`

El comando debe ejecutarse dentro de `frontend`, no dentro de `v2`:

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper\frontend"
npm.cmd install
```

### `ModuleNotFoundError: No module named 'openpyxl'`

Activar `.venv` e instalar las dependencias Python:

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper"
.\.venv\Scripts\Activate.ps1
python -m pip install requests openpyxl
```

### `vite proxy error: ECONNREFUSED`

La API Python no está ejecutándose. Iniciar `python server.py` en otra
terminal y mantenerla abierta mientras se usa Vite.

### El puerto 8000 está ocupado

Cerrar el proceso que utiliza el puerto o ejecutar el servidor con un puerto
alternativo modificando `PORT` en `server.py`. Si se usa Vite, actualizar
también el destino del proxy en `frontend/vite.config.ts`.

## Validación del frontend

Después de modificar el frontend:

```powershell
cd "C:\Users\DATAX\OneDrive\Documentos\PortalScrapper\frontend"
npm.cmd run build
```

El build genera `frontend/dist`, que es servido automáticamente por
`server.py`.
