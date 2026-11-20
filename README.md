# PortalScrapper DataX

Aplicación para consultar la consolidación SPIM de DataX Bolivia desde un
dashboard React. Permite buscar por código SPIM, revisar la información de
origen y abrir el producto del portal o copiar su ruta de descarga interna.

## Arquitectura

```text
PortalScrapper/
├── server.py                  # API local y servidor del dashboard compilado
├── frontend/                  # Aplicación React + Vite
├── diccionary/
│   └── DATAX_Consolidacion_Tabla_Web.csv
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

## GitHub Pages

El frontend puede publicarse en GitHub Pages. El workflow
`.github/workflows/pages.yml` genera una instantánea estática con los datos
CSV disponibles en el repositorio y publica `frontend/dist`.

1. En GitHub abrir **Settings > Pages**.
2. En **Build and deployment**, elegir **GitHub Actions**.
3. Ejecutar el workflow o subir cambios a `main`.

La página queda disponible bajo `/PortalScrapper/` mientras se use el
nombre actual del repositorio. En esa versión no están disponibles el
scraper ni las operaciones POST: son funciones exclusivas de `server.py`
local. Los datos publicados se actualizan solamente al ejecutar el workflow
de nuevo.

## Funcionalidades del dashboard

- Consultar la consolidación CSV sin importar manualmente los datos.
- Ver un dashboard interactivo con datasets por `Path Analyze`.
- Separar cada path en fuente de origen y carpeta del dataset; `OTROS HISTÓRICOS` se trata como categoría histórica.
- Comparar vigentes frente a `OTROS HISTÓRICOS`.
- Estimar el porcentaje actualizado usando fecha, periodicidad del portal y máximo retraso.
- Calcular el estado activo con los límites de `diccionary/maximoRetraso.csv`, excluyendo `OTROS HISTÓRICOS`.
- Mostrar un ranking de fuentes por índice de desactualización (`atrasados / evaluados`).
- Excluir del ranking las fuentes cuyo índice de desactualización sea 100%.
- Buscar por código SPIM, nombre o ID de producto del portal.
- Filtrar por fuente de origen.
- Abrir el producto Datax en un botón.
- Copiar la ruta de descarga en servidor.
- Descargar el CSV de consolidación.

## Reglas de monitoreo

El estado activo del dashboard se calcula comparando la fecha publicada del
scraper con la fecha límite esperada:

```text
fecha límite = fecha publicada + frecuencia de actualización + (máximo retraso × 1,20)
```

Por ejemplo, un dataset anual publicado en diciembre de 2025 con un máximo
retraso de 6 meses permanece `Actualizado` hasta aproximadamente julio/agosto de 2027, aplicando una
tolerancia adicional del 20% (7,2 meses de tolerancia). El día exacto depende
del día de publicación. El cálculo usa meses calendario para frecuencias
mensuales, semestrales y anuales.

El estado calculado por `v2/PortalScrapper.py` compara únicamente la fecha
publicada con la periodicidad del dataset:

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
| `GET` | `/api/status` | Productos del portal enriquecidos con la consolidación SPIM |
| `POST` | `/api/run-v2` | Ejecuta `v2/PortalScrapper.py` |
| `POST` | `/api/convert-excel` | Convierte el CSV de consolidación a Excel |
| `GET` | `/downloads/consolidacion/<archivo>` | Descarga el CSV de consolidación |
| `GET` | `/downloads/<archivo>` | Descarga archivos generados por v2 |

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
