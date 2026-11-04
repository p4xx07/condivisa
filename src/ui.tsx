import type { ReactNode } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { Avatar as DiceBearAvatar, Style } from '@dicebear/core'
import avataaars from '@dicebear/styles/avataaars.json'
import { toneFor } from './colors'

const avatarStyle = new Style(avataaars)
const avatarCache = new Map<string, string>()
function avatarUrl(name: string) {
  let url = avatarCache.get(name)
  if (!url) {
    url = new DiceBearAvatar(avatarStyle, { seed: name }).toDataUri()
    avatarCache.set(name, url)
  }
  return url
}

export function Button({ children, onClick, variant = 'primary', disabled = false, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string
}) {
  return <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>
}
export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Chiudi" onClick={onClose}><X size={20} /></button></div>
      <div className="modal-body">{children}</div>
    </section>
  </div>
}
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const palette = ['mint', 'lavender', 'peach', 'sky', 'rose']
  return <span className={`avatar avatar-${size} avatar-${palette[toneFor(name)]}`} title={name}><img src={avatarUrl(name)} alt="" loading="lazy" /></span>
}
export function Empty({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{detail}</p>{action}</div>
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}
export function SectionTitle({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="section-title"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>
}
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="link-button" onClick={onClick}>{children}<ArrowRight size={15} /></button>
}
export function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="toast" role="alert"><span>{message}</span><button onClick={onClose} aria-label="Chiudi"><X size={16} /></button></div>
}
