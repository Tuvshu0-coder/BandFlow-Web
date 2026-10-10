import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import { createWork, recommendWorkers, type RecommendationBadge, type RecommendationResult } from '../api'
import Avatar from '../components/Avatar'
import { PageHeader, Spinner } from '../components/ui'
import { bandDeliveryNotice, errorText } from '../format'
import { useSession } from '../session'

const badgeLabels: Record<RecommendationBadge, string> = { recommended: 'Recommended', skill_mismatch: 'Skill mismatch', high_workload: 'High workload', away: 'Away', offline: 'Offline' }
const quietBadge: CSSProperties = { background: 'var(--input-bg)', color: 'var(--body)' }
const badgeStyles: Record<RecommendationBadge, CSSProperties> = {
  recommended: { background: 'var(--done-soft)', color: 'var(--done)' },
  skill_mismatch: { background: 'var(--review-soft)', color: 'var(--review)' },
  high_workload: { background: 'var(--input-bg)', color: 'var(--danger)' },
  away: quietBadge,
  offline: quietBadge,
}

export default function AssignWork() {
  const { profile, refreshWork, showNotice } = useSession()
  const navigate = useNavigate()
  const [result, setResult] = useState<RecommendationResult | null>(null)
  // Once the boss picks someone by hand, a new ranking no longer moves the selection.
  const [pickedId, setPickedId] = useState('')
  // The brief the current ranking (or error) answers; while it differs from what is typed, a ranking is on its way.
  const [answeredBrief, setAnsweredBrief] = useState<string | null>(null)
  const [matchError, setMatchError] = useState('')
  const [brief, setBrief] = useState('')
  const [isAssigning, setIsAssigning] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const latestRequest = useRef(0)

  // Rank the team again shortly after the boss stops typing. The first run (empty brief) lists everyone
  // by workload; a slow answer for older text is dropped when newer text has been asked about since.
  useEffect(() => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    const asked = brief.trim()
    const timer = setTimeout(async () => {
      try {
        const next = await recommendWorkers(asked)
        if (latestRequest.current !== requestId) return
        setResult(next)
        setMatchError('')
      } catch (error) {
        if (latestRequest.current !== requestId) return
        setMatchError(errorText(error, 'The recommendation could not be loaded.'))
      }
      setAnsweredBrief(asked)
    }, asked ? 800 : 0)
    return () => clearTimeout(timer)
  }, [brief])

  const isMatching = answeredBrief !== brief.trim()
  const recommendations = result?.recommendations ?? []
  const selected = recommendations.find((entry) => entry.worker_id === pickedId) ?? recommendations[0]
  const selectedId = selected?.worker_id
  const title = brief.trim().split('\n')[0].trim()
  const skillSummary = !result || result.source === 'none' ? 'Describe the work to match skills. Ranked by workload for now.'
    : !result.required_skills.length ? 'No specific skill found in the text. Ranked by workload.'
    : `${result.source === 'ai' ? 'AI picked' : 'Keyword match (AI unavailable)'}: ${result.required_skills.join(', ')}`

  const assign = async () => {
    if (!title || !selected) return
    setIsAssigning(true)
    setErrorMessage('')
    try {
      const result = await createWork({ title, priority: 'Medium', subtasks: [], assignedTo: selected.worker_id })
      await refreshWork()
      showNotice(bandDeliveryNotice([result]))
      navigate('/', { replace: true })
    } catch (error) {
      setErrorMessage(errorText(error, 'Unable to assign the work.'))
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <div className="page page-narrow">
      <PageHeader kicker="SMART ASSIGNMENT" title="Find the right owner" aside={<span style={{ color: 'var(--accent)', fontSize: 24 }}>✦</span>} />

      <section className="hero" style={{ gap: 8 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900 }}>Skill first, then free hands.</h2>
        <p style={{ margin: 0 }}>Describe the work. BandFlow ranks your team by who has the skill and the fewest open works.</p>
      </section>

      <p className="section-label">THE WORK</p>
      <section className="card form">
        <textarea className="textarea" placeholder="What needs to move forward?" value={brief} onChange={(event) => setBrief(event.target.value)} />
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>A sentence or two is enough for a useful recommendation. The first line becomes the task title.</p>
      </section>

      <p className="section-label">RECOMMENDED OWNER</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{isMatching ? 'Matching…' : skillSummary}</p>
      {isMatching && !result ? <Spinner /> : null}
      {matchError ? <p className="message-error">{matchError}</p> : null}
      {!isMatching && !matchError && recommendations.length === 0 ? (
        <section className="card">
          <h2 className="card-title">No worker accounts found</h2>
          <p style={{ margin: '4px 0 0' }}>Create a worker account before assigning work.</p>
        </section>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {recommendations.map((entry, index) => {
          const isSelected = entry.worker_id === selectedId
          return (
            <button
              key={entry.worker_id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`select-row${isSelected ? ' selected' : ''}`}
              onClick={() => setPickedId(entry.worker_id)}
            >
              <span className="chip" style={{ background: isSelected ? 'var(--accent)' : 'var(--input-bg)', color: isSelected ? 'var(--accent-text)' : 'var(--body)' }}>{String(index + 1).padStart(2, '0')}</span>
              <Avatar name={entry.name} size={40} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong>{entry.name}</strong>
                <small>{entry.reason}</small>
                {entry.badges.length > 0 || entry.skills.length > 0 ? (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {entry.badges.map((badge) => <span key={badge} className="chip" style={badgeStyles[badge]}>{badgeLabels[badge]}</span>)}
                    {entry.skills.map((skill) => {
                      const isMatch = entry.matched_skills.includes(skill)
                      return <span key={skill} className="chip" style={{ border: `1px solid ${isMatch ? 'var(--done)' : 'var(--border)'}`, color: isMatch ? 'var(--done)' : 'var(--body)' }}>{skill}</span>
                    })}
                  </span>
                ) : null}
              </span>
              <strong style={{ color: entry.score >= 70 ? 'var(--done)' : entry.score >= 40 ? 'var(--review)' : 'var(--danger)', flexShrink: 0 }}>{entry.score}%</strong>
              <span className="radio" style={{ marginLeft: 0 }} />
            </button>
          )
        })}
      </div>

      {selected ? (
        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name={selected.name} size={44} />
          <div>
            <p className="kicker" style={{ color: 'var(--body)' }}>ASSIGNMENT PREVIEW</p>
            <strong style={{ color: 'var(--title)' }}>{selected.name} will own this work</strong>
            <p style={{ margin: '2px 0 0', fontSize: 13 }}>They'll get the brief, priority, and a clear starting point.</p>
          </div>
        </section>
      ) : null}

      {errorMessage ? <p className="message-error">{errorMessage}</p> : null}
      <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 54 }} disabled={!selected || !title || isAssigning} onClick={() => void assign()}>
        {isAssigning ? <Spinner /> : selected ? `Assign to ${selected.name}  →` : 'Select a worker'}
      </button>
      <p className="footer-note" style={{ marginTop: 0 }}>Signed in as {profile?.fullName}</p>
    </div>
  )
}
