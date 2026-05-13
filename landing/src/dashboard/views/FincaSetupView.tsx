import { useState, useEffect, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type LatLng = [number, number]

interface LoteDibujado {
  tempId: string
  nombre: string
  coords: LatLng[]
  ha: number
  colorIdx: number
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function calcularHectareas(coords: LatLng[]): number {
  if (coords.length < 3) return 0
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6378137
  let area = 0
  const n = coords.length
  for (let i = 0; i < n; i++) {
    const [lat1, lng1] = coords[i]
    const [lat2, lng2] = coords[(i + 1) % n]
    area += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
  }
  return Math.round(Math.abs(area * R * R / 2) / 1000) / 10
}

async function geocodificar(query: string): Promise<LatLng | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es`
    const res = await fetch(url, { headers: { 'User-Agent': 'Wasagro/1.0 (wasagro@proton.me)' } })
    const data = await res.json()
    if (!data.length) return null
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
  } catch {
    return null
  }
}

// Ray-casting point-in-polygon
function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  const [px, py] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

function segmentsIntersect(a1: LatLng, a2: LatLng, b1: LatLng, b2: LatLng): boolean {
  function cross(o: LatLng, a: LatLng, b: LatLng) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  }
  const d1 = cross(b1, b2, a1); const d2 = cross(b1, b2, a2)
  const d3 = cross(a1, a2, b1); const d4 = cross(a1, a2, b2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function polygonsOverlap(a: LatLng[], b: LatLng[]): boolean {
  if (a.some(pt => pointInPolygon(pt, b))) return true
  if (b.some(pt => pointInPolygon(pt, a))) return true
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]; const a2 = a[(i + 1) % a.length]
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]; const b2 = b[(j + 1) % b.length]
      if (segmentsIntersect(a1, a2, b1, b2)) return true
    }
  }
  return false
}

const COLORES = ['#3EBB6A', '#2A50D4', '#D45828', '#C9A800', '#9C9080', '#C43020', '#6B7280', '#E07820']

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

function makeVertexIcon(L: any, isFirst = false) {
  const size = isFirst ? 14 : 10
  const bg = isFirst ? 'rgba(201,240,59,0.25)' : '#C9F03B'
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${bg};border:2.5px solid #1B3D24;border-radius:50%;cursor:grab;box-sizing:border-box;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// ── Componente principal ──────────────────────────────────────────────────────

export function FincaSetupView() {
  const { user, login } = useAuth()
  const finca_id = user?.finca_id ?? new URLSearchParams(window.location.search).get('finca_id')

  // Pasos
  const [step, setStep] = useState<1 | 2>(1)

  // Búsqueda
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [mapReady, setMapReady] = useState(false)
  const [fincaCenter, setFincaCenter] = useState<[number, number] | null>(null)

  // Dibujo
  const [drawMode, setDrawMode] = useState<'idle' | 'drawing'>('idle')
  const [wipCount, setWipCount] = useState(0)
  const [lots, setLots] = useState<LoteDibujado[]>([])
  const [naming, setNaming] = useState(false)
  const [lotName, setLotName] = useState('')
  const lotNameRef = useRef<HTMLInputElement>(null)

  // Edición
  const [editingLotId, setEditingLotId] = useState<string | null>(null)
  const [editingLotOrigName, setEditingLotOrigName] = useState('')
  const editingLotDataRef = useRef<LoteDibujado | null>(null)
  const editingColorIdxRef = useRef<number>(0)

  // Validación
  const [overlapError, setOverlapError] = useState(false)

  // Guardado
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Leaflet refs
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<LeafletMap | null>(null)
  const leafletRef    = useRef<any>(null)
  const drawingRef    = useRef(false)
  const wipPts        = useRef<LatLng[]>([])
  const wipLine       = useRef<any>(null)
  const wipMarkers    = useRef<any[]>([])
  const polyLayers    = useRef<Map<string, any>>(new Map())
  const lotsRef       = useRef<LoteDibujado[]>([])

  useEffect(() => { lotsRef.current = lots }, [lots])

  // Si el usuario está logueado pero no tiene finca_id (sesión antigua), lo obtiene del servidor
  useEffect(() => {
    if (!user || user.finca_id) return
    fetch(`/api/auth/me?phone=${encodeURIComponent(user.phone)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user?.finca_id) login({ ...user, finca_id: data.user.finca_id })
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phone])

  // Obtener coordenadas de la finca en cuanto tengamos finca_id
  useEffect(() => {
    if (!finca_id) return
    fetch(`/api/finca/${finca_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.finca?.coordenadas) return
        const [lng, lat] = data.finca.coordenadas.coordinates
        setFincaCenter([lat, lng])
      })
      .catch(() => {})
  }, [finca_id])

  // Centrar el mapa cuando ambos estén listos (map + coordenadas)
  useEffect(() => {
    if (!mapReady || !fincaCenter || !mapRef.current) return
    mapRef.current.setView(fincaCenter, 15)
  }, [mapReady, fincaCenter])

  // ── Init mapa ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    import('leaflet').then((L) => {
      leafletRef.current = L

      const map = L.map(containerRef.current!, {
        center: [-1.831239, -78.183406],
        zoom: 7,
        zoomControl: true,
        attributionControl: true,
        doubleClickZoom: false,
      })

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxZoom: 20 }
      ).addTo(map)

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, opacity: 0.55 }
      ).addTo(map)

      // Click handler — añade vértice draggable
      map.on('click', (e) => {
        if (!drawingRef.current) return
        const pt: LatLng = [e.latlng.lat, e.latlng.lng]
        wipPts.current.push(pt)
        const idx = wipPts.current.length - 1
        setWipCount(wipPts.current.length)

        if (wipLine.current) {
          wipLine.current.setLatLngs([...wipPts.current, wipPts.current[0]])
        } else {
          wipLine.current = L.polyline([...wipPts.current], {
            color: '#C9F03B', weight: 2.5, dashArray: '8 5',
          }).addTo(map)
          wipLine.current.setLatLngs([...wipPts.current, wipPts.current[0]])
        }

        const m = L.marker(e.latlng, {
          draggable: true,
          icon: makeVertexIcon(L, idx === 0),
        }).addTo(map)

        m.on('drag', (ev: any) => {
          wipPts.current[idx] = [ev.latlng.lat, ev.latlng.lng]
          wipLine.current?.setLatLngs([...wipPts.current, wipPts.current[0]])
        })

        wipMarkers.current.push(m)
      })

      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      polyLayers.current.clear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setTimeout(() => mapRef.current?.invalidateSize(), 50)
  }, [step])

  // ── Acciones ─────────────────────────────────────────────────────────────────

  async function handleBuscar() {
    if (!search.trim()) return
    setSearching(true)
    setSearchError('')
    const coords = await geocodificar(search)
    setSearching(false)
    if (!coords) {
      setSearchError('No encontré esa ubicación. Probá con el nombre del cantón o parroquia.')
      return
    }
    mapRef.current?.setView(coords, 16)
    setMapReady(true)
  }

  function startDrawing() {
    drawingRef.current = true
    setDrawMode('drawing')
    if (mapRef.current) mapRef.current.getContainer().style.cursor = 'crosshair'
  }

  function startEditingLot(lot: LoteDibujado) {
    const L = leafletRef.current
    if (!L || !mapRef.current) return

    polyLayers.current.get(lot.tempId)?.remove()
    polyLayers.current.delete(lot.tempId)

    editingLotDataRef.current = lot
    editingColorIdxRef.current = lot.colorIdx
    wipPts.current = [...lot.coords]
    setWipCount(lot.coords.length)
    setEditingLotId(lot.tempId)
    setEditingLotOrigName(lot.nombre)

    // Crear marcadores draggables para cada vértice existente
    lot.coords.forEach((coord, idx) => {
      const m = L.marker([coord[0], coord[1]], {
        draggable: true,
        icon: makeVertexIcon(L, idx === 0),
      }).addTo(mapRef.current!)
      m.on('drag', (ev: any) => {
        wipPts.current[idx] = [ev.latlng.lat, ev.latlng.lng]
        wipLine.current?.setLatLngs([...wipPts.current, wipPts.current[0]])
      })
      wipMarkers.current.push(m)
    })

    wipLine.current = L.polyline([...lot.coords, lot.coords[0]], {
      color: '#C9F03B', weight: 2.5, dashArray: '8 5',
    }).addTo(mapRef.current!)

    setLots(prev => prev.filter(l => l.tempId !== lot.tempId))
    setOverlapError(false)
    drawingRef.current = true
    setDrawMode('drawing')
    if (mapRef.current) mapRef.current.getContainer().style.cursor = 'crosshair'
  }

  function undoLastPoint() {
    if (!wipPts.current.length) return
    wipPts.current.pop()
    setWipCount(wipPts.current.length)
    const last = wipMarkers.current.pop()
    if (last) last.remove()
    if (wipLine.current) {
      if (wipPts.current.length >= 1) {
        wipLine.current.setLatLngs([...wipPts.current, wipPts.current[0]])
      } else {
        wipLine.current.remove()
        wipLine.current = null
      }
    }
  }

  function clearWip() {
    wipLine.current?.remove(); wipLine.current = null
    wipMarkers.current.forEach(m => m.remove()); wipMarkers.current = []
    wipPts.current = []
  }

  function cancelDrawing() {
    clearWip()
    drawingRef.current = false
    setDrawMode('idle')
    setWipCount(0)
    setOverlapError(false)

    // Si estábamos editando, restaurar el lote original
    if (editingLotId && editingLotDataRef.current) {
      const lot = editingLotDataRef.current
      import('leaflet').then((L) => {
        const color = COLORES[lot.colorIdx % COLORES.length]
        const poly = L.polygon(lot.coords, { color, weight: 2, fillColor: color, fillOpacity: 0.4 })
        poly.bindTooltip(
          `<div style="font-family:system-ui;font-size:12px;font-weight:700;">${lot.nombre}</div>
           <div style="font-size:11px;opacity:0.7;">${lot.ha} ha</div>`,
          { permanent: true, direction: 'center', className: 'wasagro-setup-tooltip', opacity: 0.96 }
        )
        poly.addTo(mapRef.current!)
        polyLayers.current.set(lot.tempId, poly)
      })
      setLots(prev => [...prev, lot])
      setEditingLotId(null)
      setEditingLotOrigName('')
      editingLotDataRef.current = null
    }

    if (mapRef.current) mapRef.current.getContainer().style.cursor = ''
  }

  function closeLot() {
    if (wipPts.current.length < 3) return
    setOverlapError(false)
    setNaming(true)
    setLotName(editingLotOrigName)
    setTimeout(() => lotNameRef.current?.focus(), 80)
  }

  function confirmNaming() {
    const coords = [...wipPts.current] as LatLng[]

    // Validar superposición con lotes existentes
    const overlaps = lotsRef.current.some(existing => polygonsOverlap(coords, existing.coords))
    if (overlaps) {
      setOverlapError(true)
      setNaming(false)
      return
    }

    const isEditing = editingLotId !== null
    const nombre = lotName.trim() || (isEditing ? editingLotOrigName : `Lote ${lotsRef.current.length + 1}`)
    const ha     = calcularHectareas(coords)
    const tempId = isEditing ? editingLotId! : `lot-${Date.now()}`
    const colorIdx = isEditing ? editingColorIdxRef.current : lotsRef.current.length
    const color  = COLORES[colorIdx % COLORES.length]

    import('leaflet').then((L) => {
      const poly = L.polygon(coords, { color, weight: 2, fillColor: color, fillOpacity: 0.4 })
      poly.bindTooltip(
        `<div style="font-family:system-ui;font-size:12px;font-weight:700;">${nombre}</div>
         <div style="font-size:11px;opacity:0.7;">${ha} ha</div>`,
        { permanent: true, direction: 'center', className: 'wasagro-setup-tooltip', opacity: 0.96 }
      )
      poly.addTo(mapRef.current!)
      polyLayers.current.set(tempId, poly)
    })

    const newLot: LoteDibujado = { tempId, nombre, coords, ha, colorIdx }
    setLots(prev => [...prev, newLot])

    if (isEditing) {
      setEditingLotId(null)
      setEditingLotOrigName('')
      editingLotDataRef.current = null
      clearWip()
      setWipCount(0)
      drawingRef.current = false
      setDrawMode('idle')
      if (mapRef.current) mapRef.current.getContainer().style.cursor = ''
    } else {
      clearWip()
      setWipCount(0)
      drawingRef.current = true
      setDrawMode('drawing')
    }

    setNaming(false)
    setLotName('')
    setOverlapError(false)
  }

  function deleteLot(tempId: string) {
    polyLayers.current.get(tempId)?.remove()
    polyLayers.current.delete(tempId)
    setLots(prev => prev.filter(l => l.tempId !== tempId))
  }

  async function handleGuardar() {
    if (!finca_id) {
      setSaveError('No se encontró el ID de tu finca. Contactá a soporte.')
      return
    }
    if (!lots.length) return
    setSaving(true)
    setSaveError('')
    try {
      for (const lot of lots) {
        const res = await fetch(`/api/finca/${finca_id}/lotes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: lot.nombre, hectareas: lot.ha, coordenadas: lot.coords }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error ?? `HTTP ${res.status}`)
        }
      }
      setSavedOk(true)
    } catch (e: any) {
      setSaveError(e.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // ── Instrucción contextual ────────────────────────────────────────────────────

  function instruccion() {
    if (editingLotId) return `Editando "${editingLotOrigName}" — mové vértices arrastrándolos o agregá más clicando. Cerrá cuando esté listo.`
    if (drawMode === 'idle') {
      return lots.length === 0
        ? 'Tocá "Nuevo lote" para empezar a dibujar. Cada clic marca un vértice.'
        : 'Tocá "Nuevo lote" para dibujar otro lote, o guardá los que ya tenés.'
    }
    if (wipCount === 0) return 'Tocá sobre el mapa para marcar el primer vértice del lote.'
    if (wipCount < 3) return `${wipCount} vértice${wipCount > 1 ? 's' : ''} — necesitás al menos 3 para cerrar el lote.`
    return `${wipCount} vértices — podés arrastrar cualquier vértice para moverlo. Tocá "Cerrar lote" cuando esté listo.`
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const totalHa = lots.reduce((s, l) => s + l.ha, 0)

  if (savedOk) {
    return (
      <>
        <Topbar
          title="Configurar finca"
          badge="Lotes guardados"
          avatarInitials={user ? getInitials(user.nombre) : 'WA'}
        />
        <main style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <div style={{ background: '#EDFBF3', border: '2px solid #3EBB6A', boxShadow: '4px 4px 0 #3EBB6A', padding: '32px 48px', textAlign: 'center', maxWidth: 480 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0D0F0C', marginBottom: 6 }}>
              {lots.length} lote{lots.length !== 1 ? 's' : ''} guardado{lots.length !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(13,15,12,0.55)', marginBottom: 20 }}>
              {lots.map(l => l.nombre).join(' · ')} · {totalHa.toFixed(1)} ha total
            </div>
            <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.4)' }}>
              Los lotes ya están en Supabase con sus coordenadas PostGIS. El mapa de plagas y los reportes los van a usar automáticamente.
            </div>
          </div>
          <button
            onClick={() => { setLots([]); setSavedOk(false); setStep(2); polyLayers.current.clear() }}
            style={{ fontSize: 13, fontWeight: 700, color: '#2A50D4', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Agregar más lotes
          </button>
        </main>
      </>
    )
  }

  return (
    <>
      <style>{`
        .wasagro-setup-tooltip {
          background: rgba(255,255,255,0.96) !important;
          border: 1.5px solid rgba(13,15,12,0.15) !important;
          border-radius: 0 !important;
          box-shadow: 2px 2px 0 rgba(13,15,12,0.1) !important;
          padding: 5px 9px !important;
        }
        .wasagro-setup-tooltip::before { display: none !important; }
        .leaflet-interactive { cursor: crosshair !important; }
      `}</style>

      <Topbar
        title="Configurar finca"
        badge={step === 1 ? 'Paso 1 — Ubicar' : `Paso 2 — Dibujar lotes · ${lots.length} dibujado${lots.length !== 1 ? 's' : ''}`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />

      <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 'calc(100vh - 56px)' }}>

        {/* ── Paso 1: buscador ──────────────────────────────────────────────── */}
        {step === 1 && (
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 #0D0F0C', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0D0F0C', marginBottom: 4 }}>¿Dónde está tu finca?</div>
              <div style={{ fontSize: 13, color: 'rgba(13,15,12,0.5)' }}>Escribí la parroquia, cantón o dirección más cercana. El mapa se va a centrar ahí.</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBuscar()}
                placeholder="Ej: Pimocha, Babahoyo · Quinindé, Esmeraldas · La Maná"
                style={{ flex: 1, padding: '10px 14px', fontSize: 14, border: '2px solid #0D0F0C', outline: 'none', fontFamily: 'inherit', background: '#fff' }}
              />
              <button
                onClick={handleBuscar}
                disabled={searching || !search.trim()}
                style={{ padding: '10px 20px', fontWeight: 700, fontSize: 13, background: searching ? '#9C9080' : '#1B3D24', color: '#C9F03B', border: '2px solid #0D0F0C', cursor: searching ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {searching ? 'Buscando…' : 'Ubicar en mapa'}
              </button>
            </div>
            {searchError && <div style={{ fontSize: 12, color: '#C43020', fontWeight: 600 }}>{searchError}</div>}
          </div>
        )}

        {/* ── Toolbar de dibujo (paso 2) ───────────────────────────────────── */}
        {step === 2 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              flex: 1, fontSize: 13, padding: '9px 14px', minWidth: 200,
              fontWeight: overlapError ? 700 : 400,
              color: overlapError ? '#C43020' : 'rgba(13,15,12,0.6)',
              background: overlapError ? '#FFEEEA' : '#F5F1E8',
              border: `1px solid ${overlapError ? '#C43020' : 'rgba(13,15,12,0.15)'}`,
            }}>
              {overlapError
                ? 'Este lote se superpone con uno existente. Corregí el polígono antes de cerrarlo.'
                : instruccion()}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {drawMode === 'idle' ? (
                <button
                  onClick={startDrawing}
                  style={{ padding: '9px 16px', fontWeight: 700, fontSize: 13, background: '#1B3D24', color: '#C9F03B', border: '2px solid #0D0F0C', cursor: 'pointer' }}
                >
                  + Nuevo lote
                </button>
              ) : (
                <>
                  <button
                    onClick={undoLastPoint}
                    disabled={wipCount === 0}
                    style={{ padding: '9px 14px', fontWeight: 600, fontSize: 13, background: wipCount === 0 ? '#F5F1E8' : '#FFF0E6', color: wipCount === 0 ? 'rgba(13,15,12,0.3)' : '#E06820', border: '2px solid #0D0F0C', cursor: wipCount === 0 ? 'default' : 'pointer' }}
                  >
                    ↩ Deshacer
                  </button>
                  <button
                    onClick={cancelDrawing}
                    style={{ padding: '9px 14px', fontWeight: 600, fontSize: 13, background: '#FFEEEA', color: '#C43020', border: '2px solid #0D0F0C', cursor: 'pointer' }}
                  >
                    {editingLotId ? 'Cancelar edición' : 'Cancelar'}
                  </button>
                  <button
                    onClick={closeLot}
                    disabled={wipCount < 3}
                    style={{ padding: '9px 16px', fontWeight: 700, fontSize: 13, background: wipCount >= 3 ? '#C9F03B' : '#F5F1E8', color: wipCount >= 3 ? '#0D0F0C' : 'rgba(13,15,12,0.3)', border: '2px solid #0D0F0C', cursor: wipCount >= 3 ? 'pointer' : 'default' }}
                  >
                    {editingLotId ? 'Actualizar lote ✓' : 'Cerrar lote ✓'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Layout mapa + panel ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 480 }}>

          {/* Mapa */}
          <div style={{ flex: 1, border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 #0D0F0C', overflow: 'hidden', position: 'relative', minHeight: 440 }}>
            <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 440 }} />
            {step === 1 && !mapReady && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(27,61,36,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ textAlign: 'center', color: '#C9F03B' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🗺</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Buscá tu finca arriba</div>
                </div>
              </div>
            )}
          </div>

          {/* Panel derecho */}
          <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {step === 1 ? (
              <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(13,15,12,0.45)', textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>¿Cómo funciona?</div>
                {[
                  { n: '1', t: 'Ubicar', d: 'Buscá la parroquia o cantón de tu finca.' },
                  { n: '2', t: 'Dibujar', d: 'Marcá los bordes de cada lote tocando el mapa. Podés arrastrar vértices para ajustar.' },
                  { n: '3', t: 'Nombrar', d: 'Cada lote tiene su nombre: "El de arriba", "Lote 3", etc.' },
                  { n: '4', t: 'Guardar', d: 'Los polígonos se guardan en tu finca en Supabase.' },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 22, height: 22, background: '#1B3D24', color: '#C9F03B', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.n}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C' }}>{s.t}</div>
                      <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.5)', marginTop: 2 }}>{s.d}</div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setStep(2)}
                  style={{ marginTop: 4, padding: '12px', fontWeight: 800, fontSize: 14, background: '#1B3D24', color: '#C9F03B', border: '2px solid #0D0F0C', cursor: 'pointer', boxShadow: '3px 3px 0 #0D0F0C' }}
                >
                  Empezar a dibujar →
                </button>
              </div>
            ) : (
              <>
                {/* Lista de lotes */}
                <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '3px 3px 0 #0D0F0C', overflow: 'hidden', flex: 1 }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(13,15,12,0.4)' }}>
                      Lotes dibujados · {lots.length}
                    </span>
                  </div>

                  {lots.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'rgba(13,15,12,0.35)', fontSize: 12 }}>
                      Ningún lote todavía.<br />Tocá "Nuevo lote" para empezar.
                    </div>
                  ) : (
                    lots.map((lot) => {
                      const color = COLORES[lot.colorIdx % COLORES.length]
                      const isBusy = drawMode === 'drawing'
                      return (
                        <div key={lot.tempId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.06)' }}>
                          <div style={{ width: 10, height: 10, background: color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lot.nombre}</div>
                            <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.4)', marginTop: 1 }}>{lot.ha} ha · {lot.coords.length} vértices</div>
                          </div>
                          <button
                            onClick={() => startEditingLot(lot)}
                            disabled={isBusy}
                            title="Editar polígono"
                            style={{ background: 'none', border: 'none', color: isBusy ? 'rgba(13,15,12,0.2)' : '#2A50D4', cursor: isBusy ? 'default' : 'pointer', fontSize: 14, lineHeight: 1, padding: 2 }}
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => deleteLot(lot.tempId)}
                            disabled={isBusy}
                            title="Eliminar"
                            style={{ background: 'none', border: 'none', color: isBusy ? 'rgba(13,15,12,0.2)' : '#C43020', cursor: isBusy ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, padding: 2 }}
                          >
                            ×
                          </button>
                        </div>
                      )
                    })
                  )}

                  {lots.length > 0 && (
                    <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.02)' }}>
                      <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.4)', fontWeight: 700 }}>
                        Total: <span style={{ color: '#0D0F0C', fontSize: 13, fontWeight: 800 }}>{totalHa.toFixed(1)} ha</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Botón guardar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {saveError && (
                    <div style={{ fontSize: 11, color: '#C43020', fontWeight: 600, padding: '6px 10px', background: '#FFEEEA', border: '1px solid #C43020' }}>{saveError}</div>
                  )}
                  {!finca_id && (
                    <div style={{ fontSize: 11, color: '#C43020', padding: '6px 10px', background: '#FFEEEA', border: '1px solid #C43020' }}>
                      Cargando tu finca… si el problema persiste, cerrá sesión y volvé a entrar.
                    </div>
                  )}
                  <button
                    onClick={handleGuardar}
                    disabled={saving || lots.length === 0 || !finca_id}
                    style={{ padding: '13px', fontWeight: 800, fontSize: 14, background: (saving || lots.length === 0 || !finca_id) ? '#9C9080' : '#C9F03B', color: '#0D0F0C', border: '2px solid #0D0F0C', cursor: (saving || lots.length === 0 || !finca_id) ? 'default' : 'pointer', boxShadow: (saving || lots.length === 0 || !finca_id) ? 'none' : '3px 3px 0 #0D0F0C' }}
                  >
                    {saving ? 'Guardando…' : `Guardar ${lots.length} lote${lots.length !== 1 ? 's' : ''} en Supabase`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Modal: nombre del lote ───────────────────────────────────────── */}
        {naming && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(13,15,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) { setNaming(false); setLotName('') } }}
          >
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '6px 6px 0 #0D0F0C', padding: '28px 32px', width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0D0F0C', marginBottom: 4 }}>
                  {editingLotId ? 'Actualizar nombre del lote' : '¿Cómo se llama este lote?'}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.5)' }}>
                  Usá el nombre que usan en el campo — "el de arriba", "lote 3", "río".
                </div>
              </div>
              <input
                ref={lotNameRef}
                value={lotName}
                onChange={e => setLotName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmNaming()}
                placeholder={editingLotId ? editingLotOrigName : `Lote ${lots.length + 1}`}
                style={{ padding: '10px 14px', fontSize: 15, fontWeight: 600, border: '2px solid #0D0F0C', outline: 'none', fontFamily: 'inherit', background: '#fff' }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => { setNaming(false); setLotName('') }}
                  style={{ flex: 1, padding: '10px', fontWeight: 600, fontSize: 13, background: '#F5F1E8', border: '2px solid #0D0F0C', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmNaming}
                  style={{ flex: 2, padding: '10px', fontWeight: 800, fontSize: 13, background: '#1B3D24', color: '#C9F03B', border: '2px solid #0D0F0C', cursor: 'pointer', boxShadow: '3px 3px 0 #0D0F0C' }}
                >
                  {editingLotId ? 'Actualizar lote ✓' : 'Guardar lote ✓'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
