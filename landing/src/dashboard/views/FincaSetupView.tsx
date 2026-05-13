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

const COLORES = ['#3EBB6A', '#2A50D4', '#D45828', '#C9A800', '#9C9080', '#C43020', '#6B7280', '#3EBB6A']

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

// ── Componente principal ──────────────────────────────────────────────────────

export function FincaSetupView() {
  const { user } = useAuth()
  const finca_id = user?.finca_id ?? new URLSearchParams(window.location.search).get('finca_id')

  // Pasos
  const [step, setStep] = useState<1 | 2>(1)

  // Búsqueda
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [mapReady, setMapReady] = useState(false)

  // Dibujo
  const [drawMode, setDrawMode] = useState<'idle' | 'drawing'>('idle')
  const [wipCount, setWipCount] = useState(0)
  const [lots, setLots] = useState<LoteDibujado[]>([])
  const [naming, setNaming] = useState(false)
  const [lotName, setLotName] = useState('')
  const lotNameRef = useRef<HTMLInputElement>(null)

  // Guardado
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Leaflet refs
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<LeafletMap | null>(null)
  const drawingRef   = useRef(false)
  const wipPts       = useRef<LatLng[]>([])
  const wipLine      = useRef<any>(null)
  const wipMarkers   = useRef<any[]>([])
  const wipFirstDot  = useRef<any>(null)
  const polyLayers   = useRef<Map<string, any>>(new Map())
  const lotsRef      = useRef<LoteDibujado[]>([])

  // Sync lotsRef con state (para handlers de Leaflet)
  useEffect(() => { lotsRef.current = lots }, [lots])

  // ── Init mapa ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    import('leaflet').then((L) => {
      const map = L.map(containerRef.current!, {
        center: [-1.831239, -78.183406], // Ecuador centro
        zoom: 7,
        zoomControl: true,
        attributionControl: true,
        doubleClickZoom: false, // lo manejamos nosotros
      })

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxZoom: 20 }
      ).addTo(map)

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, opacity: 0.55 }
      ).addTo(map)

      // Click handler — añade vértice si estamos en modo dibujo
      map.on('click', (e) => {
        if (!drawingRef.current) return
        const pt: LatLng = [e.latlng.lat, e.latlng.lng]
        wipPts.current.push(pt)
        setWipCount(wipPts.current.length)

        // Actualizar línea WIP
        if (wipLine.current) {
          wipLine.current.setLatLngs([...wipPts.current, wipPts.current[0]])
        } else {
          wipLine.current = L.polyline([...wipPts.current], {
            color: '#C9F03B', weight: 2.5, dashArray: '8 5',
          }).addTo(map)
        }
        // Siempre actualizar la línea para cerrar visualmente
        wipLine.current.setLatLngs([...wipPts.current, wipPts.current[0]])

        // Marcador de vértice
        const m = L.circleMarker(e.latlng, {
          radius: 5,
          fillColor: '#C9F03B',
          fillOpacity: 1,
          color: '#1B3D24',
          weight: 2,
        }).addTo(map)
        wipMarkers.current.push(m)

        // Punto especial en el primero (indica cierre)
        if (wipPts.current.length === 1) {
          wipFirstDot.current = L.circleMarker(e.latlng, {
            radius: 8,
            fillColor: '#C9F03B',
            fillOpacity: 0.25,
            color: '#C9F03B',
            weight: 2,
          }).addTo(map)
        }
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

  // Invalidar tamaño cuando cambia el paso (el contenedor puede cambiar de tamaño)
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
    if (mapRef.current) {
      mapRef.current.getContainer().style.cursor = 'crosshair'
    }
  }

  function undoLastPoint() {
    if (!wipPts.current.length) return
    wipPts.current.pop()
    setWipCount(wipPts.current.length)

    // Quitar último marcador
    const last = wipMarkers.current.pop()
    if (last) last.remove()

    // Actualizar línea
    if (wipLine.current) {
      if (wipPts.current.length >= 1) {
        wipLine.current.setLatLngs([...wipPts.current, wipPts.current[0]])
      } else {
        wipLine.current.remove()
        wipLine.current = null
      }
    }
    if (wipPts.current.length === 0 && wipFirstDot.current) {
      wipFirstDot.current.remove()
      wipFirstDot.current = null
    }
  }

  function cancelDrawing() {
    clearWip()
    drawingRef.current = false
    setDrawMode('idle')
    setWipCount(0)
    if (mapRef.current) {
      mapRef.current.getContainer().style.cursor = ''
    }
  }

  function clearWip() {
    wipLine.current?.remove(); wipLine.current = null
    wipMarkers.current.forEach(m => m.remove()); wipMarkers.current = []
    wipFirstDot.current?.remove(); wipFirstDot.current = null
    wipPts.current = []
  }

  function closeLot() {
    if (wipPts.current.length < 3) return
    setNaming(true)
    setLotName('')
    setTimeout(() => lotNameRef.current?.focus(), 80)
  }

  function confirmNaming() {
    const nombre = lotName.trim() || `Lote ${lots.length + 1}`
    const coords = [...wipPts.current] as LatLng[]
    const ha     = calcularHectareas(coords)
    const tempId = `lot-${Date.now()}`
    const color  = COLORES[lots.length % COLORES.length]

    // Dibujar polígono cerrado en el mapa
    import('leaflet').then((L) => {
      const poly = L.polygon(coords, {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.4,
      })

      poly.bindTooltip(
        `<div style="font-family:system-ui;font-size:12px;font-weight:700;">${nombre}</div>
         <div style="font-size:11px;opacity:0.7;">${ha} ha</div>`,
        { permanent: true, direction: 'center', className: 'wasagro-setup-tooltip', opacity: 0.96 }
      )

      poly.addTo(mapRef.current!)
      polyLayers.current.set(tempId, poly)
    })

    const newLot: LoteDibujado = { tempId, nombre, coords, ha }
    setLots(prev => [...prev, newLot])
    setNaming(false)
    setLotName('')
    clearWip()
    setWipCount(0)
    // Volver a modo dibujo listo para el siguiente lote
    drawingRef.current = true
    setDrawMode('drawing')
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
          body: JSON.stringify({
            nombre: lot.nombre,
            hectareas: lot.ha,
            coordenadas: lot.coords,
          }),
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
    if (drawMode === 'idle') {
      return lots.length === 0
        ? 'Tocá "Nuevo lote" para empezar a dibujar. Cada clic marca un vértice.'
        : 'Tocá "Nuevo lote" para dibujar otro lote, o guardá los que ya tenés.'
    }
    if (wipCount === 0) return 'Tocá sobre el mapa para marcar el primer vértice del lote.'
    if (wipCount < 3) return `${wipCount} vértice${wipCount > 1 ? 's' : ''} — necesitás al menos 3 para cerrar el lote.`
    return `${wipCount} vértices — tocá "Cerrar lote" cuando el polígono esté listo.`
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
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0D0F0C', marginBottom: 4 }}>
                ¿Dónde está tu finca?
              </div>
              <div style={{ fontSize: 13, color: 'rgba(13,15,12,0.5)' }}>
                Escribí la parroquia, cantón o dirección más cercana. El mapa se va a centrar ahí.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBuscar()}
                placeholder="Ej: Pimocha, Babahoyo · Quinindé, Esmeraldas · La Maná"
                style={{
                  flex: 1, padding: '10px 14px', fontSize: 14,
                  border: '2px solid #0D0F0C', outline: 'none',
                  fontFamily: 'inherit', background: '#fff',
                }}
              />
              <button
                onClick={handleBuscar}
                disabled={searching || !search.trim()}
                style={{
                  padding: '10px 20px', fontWeight: 700, fontSize: 13,
                  background: searching ? '#9C9080' : '#1B3D24',
                  color: '#C9F03B', border: '2px solid #0D0F0C',
                  cursor: searching ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {searching ? 'Buscando…' : 'Ubicar en mapa'}
              </button>
            </div>

            {searchError && (
              <div style={{ fontSize: 12, color: '#C43020', fontWeight: 600 }}>{searchError}</div>
            )}
          </div>
        )}

        {/* ── Toolbar de dibujo (paso 2) ───────────────────────────────────── */}
        {step === 2 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Instrucción */}
            <div style={{
              flex: 1, fontSize: 13, color: 'rgba(13,15,12,0.6)',
              padding: '9px 14px', background: '#F5F1E8', border: '1px solid rgba(13,15,12,0.15)',
              minWidth: 200,
            }}>
              {instruccion()}
            </div>

            {/* Botones */}
            <div style={{ display: 'flex', gap: 8 }}>
              {drawMode === 'idle' ? (
                <button
                  onClick={startDrawing}
                  style={{
                    padding: '9px 16px', fontWeight: 700, fontSize: 13,
                    background: '#1B3D24', color: '#C9F03B',
                    border: '2px solid #0D0F0C', cursor: 'pointer',
                  }}
                >
                  + Nuevo lote
                </button>
              ) : (
                <>
                  <button
                    onClick={undoLastPoint}
                    disabled={wipCount === 0}
                    style={{
                      padding: '9px 14px', fontWeight: 600, fontSize: 13,
                      background: wipCount === 0 ? '#F5F1E8' : '#FFF0E6',
                      color: wipCount === 0 ? 'rgba(13,15,12,0.3)' : '#E06820',
                      border: '2px solid #0D0F0C',
                      cursor: wipCount === 0 ? 'default' : 'pointer',
                    }}
                  >
                    ↩ Deshacer
                  </button>
                  <button
                    onClick={cancelDrawing}
                    style={{
                      padding: '9px 14px', fontWeight: 600, fontSize: 13,
                      background: '#FFEEEA', color: '#C43020',
                      border: '2px solid #0D0F0C', cursor: 'pointer',
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={closeLot}
                    disabled={wipCount < 3}
                    style={{
                      padding: '9px 16px', fontWeight: 700, fontSize: 13,
                      background: wipCount >= 3 ? '#C9F03B' : '#F5F1E8',
                      color: wipCount >= 3 ? '#0D0F0C' : 'rgba(13,15,12,0.3)',
                      border: '2px solid #0D0F0C',
                      cursor: wipCount >= 3 ? 'pointer' : 'default',
                    }}
                  >
                    Cerrar lote ✓
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Layout mapa + panel ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 480 }}>

          {/* Mapa */}
          <div style={{
            flex: 1,
            border: '2px solid #0D0F0C',
            boxShadow: '4px 4px 0 #0D0F0C',
            overflow: 'hidden',
            position: 'relative',
            minHeight: 440,
          }}>
            <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 440 }} />

            {/* Overlay antes de que el mapa esté listo con la ubicación */}
            {step === 1 && !mapReady && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(27,61,36,0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}>
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
                <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(13,15,12,0.45)', textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>
                  ¿Cómo funciona?
                </div>
                {[
                  { n: '1', t: 'Ubicar', d: 'Buscá la parroquia o cantón de tu finca.' },
                  { n: '2', t: 'Dibujar', d: 'Marcá los bordes de cada lote tocando el mapa.' },
                  { n: '3', t: 'Nombrar', d: 'Cada lote tiene su nombre: "El de arriba", "Lote 3", etc.' },
                  { n: '4', t: 'Guardar', d: 'Los polígonos se guardan en tu finca en Supabase.' },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 22, height: 22, background: '#1B3D24', color: '#C9F03B', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {s.n}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C' }}>{s.t}</div>
                      <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.5)', marginTop: 2 }}>{s.d}</div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => setStep(2)}
                  style={{
                    marginTop: 4, padding: '12px', fontWeight: 800, fontSize: 14,
                    background: '#1B3D24', color: '#C9F03B',
                    border: '2px solid #0D0F0C', cursor: 'pointer',
                    boxShadow: '3px 3px 0 #0D0F0C',
                  }}
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
                    lots.map((lot, i) => {
                      const color = COLORES[i % COLORES.length]
                      return (
                        <div key={lot.tempId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.06)' }}>
                          <div style={{ width: 10, height: 10, background: color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {lot.nombre}
                            </div>
                            <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.4)', marginTop: 1 }}>{lot.ha} ha · {lot.coords.length} vértices</div>
                          </div>
                          <button
                            onClick={() => deleteLot(lot.tempId)}
                            title="Eliminar"
                            style={{ background: 'none', border: 'none', color: '#C43020', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 2 }}
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
                    <div style={{ fontSize: 11, color: '#C43020', fontWeight: 600, padding: '6px 10px', background: '#FFEEEA', border: '1px solid #C43020' }}>
                      {saveError}
                    </div>
                  )}
                  {!finca_id && (
                    <div style={{ fontSize: 11, color: '#C43020', padding: '6px 10px', background: '#FFEEEA', border: '1px solid #C43020' }}>
                      Sin finca_id. Pasalo como ?finca_id=F001 o iniciá sesión como admin.
                    </div>
                  )}
                  <button
                    onClick={handleGuardar}
                    disabled={saving || lots.length === 0 || !finca_id}
                    style={{
                      padding: '13px', fontWeight: 800, fontSize: 14,
                      background: (saving || lots.length === 0 || !finca_id) ? '#9C9080' : '#C9F03B',
                      color: '#0D0F0C',
                      border: '2px solid #0D0F0C',
                      cursor: (saving || lots.length === 0 || !finca_id) ? 'default' : 'pointer',
                      boxShadow: (saving || lots.length === 0 || !finca_id) ? 'none' : '3px 3px 0 #0D0F0C',
                    }}
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
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(13,15,12,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={e => { if (e.target === e.currentTarget) { setNaming(false); setLotName('') } }}
          >
            <div style={{
              background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '6px 6px 0 #0D0F0C',
              padding: '28px 32px', width: 360, display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0D0F0C', marginBottom: 4 }}>
                  ¿Cómo se llama este lote?
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
                placeholder={`Lote ${lots.length + 1}`}
                style={{
                  padding: '10px 14px', fontSize: 15, fontWeight: 600,
                  border: '2px solid #0D0F0C', outline: 'none',
                  fontFamily: 'inherit', background: '#fff',
                }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => { setNaming(false); setLotName('') }}
                  style={{
                    flex: 1, padding: '10px', fontWeight: 600, fontSize: 13,
                    background: '#F5F1E8', border: '2px solid #0D0F0C', cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmNaming}
                  style={{
                    flex: 2, padding: '10px', fontWeight: 800, fontSize: 13,
                    background: '#1B3D24', color: '#C9F03B',
                    border: '2px solid #0D0F0C', cursor: 'pointer',
                    boxShadow: '3px 3px 0 #0D0F0C',
                  }}
                >
                  Guardar lote ✓
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
