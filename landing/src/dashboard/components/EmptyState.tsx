export function EmptyState({ icon = '—', message }: { icon?: string; message: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 10, color: 'rgba(13,15,12,0.25)' }}>{icon}</div>
      <div style={{ fontSize: 13, color: 'rgba(13,15,12,0.45)' }}>{message}</div>
    </div>
  )
}
