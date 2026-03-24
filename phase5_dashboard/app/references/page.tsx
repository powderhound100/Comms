'use client'

import { useState, useMemo } from 'react'
import {
  projects,
  subjects,
  tierLabels,
  phaseLabels,
  languageColors,
  type Subject,
  type ReferenceProject,
} from '@/data/references'
import SubjectGraph from '@/components/SubjectGraph'

type View = 'subject' | 'project'

function PhaseBadge({ phase }: { phase: number }) {
  const colors = [
    'bg-emerald-900/50 text-emerald-300 border-emerald-800',
    'bg-blue-900/50 text-blue-300 border-blue-800',
    'bg-violet-900/50 text-violet-300 border-violet-800',
    'bg-amber-900/50 text-amber-300 border-amber-800',
    'bg-rose-900/50 text-rose-300 border-rose-800',
  ]
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[phase - 1]}`}>
      P{phase}
    </span>
  )
}

function TierBadge({ tier }: { tier: number }) {
  const styles: Record<number, string> = {
    1: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
    2: 'bg-blue-900/30 text-blue-400 border-blue-800/50',
    3: 'bg-gray-800/50 text-gray-400 border-gray-700/50',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${styles[tier]}`}>
      T{tier}
    </span>
  )
}

function ProjectCard({
  project,
  onSubjectClick,
}: {
  project: ReferenceProject
  onSubjectClick: (s: Subject) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <a
            href={project.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white hover:text-emerald-400 transition-colors"
          >
            {project.name}
          </a>
          <span className="text-xs text-gray-500 ml-2">{project.stars}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${languageColors[project.language] || 'bg-gray-800 text-gray-400'}`}>
            {project.language}
          </span>
          <TierBadge tier={project.tier} />
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-3">{project.description}</p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {project.phases.map(p => (
          <PhaseBadge key={p} phase={p} />
        ))}
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        {project.subjects.map(s => {
          const sub = subjects.find(x => x.id === s)
          return (
            <button
              key={s}
              onClick={() => onSubjectClick(s)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors cursor-pointer"
            >
              {sub?.label || s}
            </button>
          )
        })}
      </div>

      {project.studyPaths.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
          >
            {expanded ? '- Hide' : '+'} {project.studyPaths.length} study path{project.studyPaths.length > 1 ? 's' : ''}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5">
              {project.studyPaths.map((sp, i) => (
                <div key={i} className="text-xs pl-3 border-l border-gray-800">
                  <code className="text-emerald-400">{sp.path}</code>
                  <div className="text-gray-500">{sp.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {project.installCmd && (
        <div className="mt-2 text-xs">
          <code className="text-gray-500 bg-gray-800/50 px-1.5 py-0.5 rounded">{project.installCmd}</code>
        </div>
      )}
    </div>
  )
}

export default function ReferencesPage() {
  const [view, setView] = useState<View>('subject')
  const [search, setSearch] = useState('')
  const [phaseFilter, setPhaseFilter] = useState<number | null>(null)
  const [tierFilter, setTierFilter] = useState<number | null>(null)
  const [subjectFilter, setSubjectFilter] = useState<Subject | null>(null)

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (phaseFilter && !p.phases.includes(phaseFilter)) return false
      if (tierFilter && p.tier !== tierFilter) return false
      if (subjectFilter && !p.subjects.includes(subjectFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        const match =
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.language.toLowerCase().includes(q) ||
          p.subjects.some(s => s.includes(q)) ||
          subjects.filter(s => p.subjects.includes(s.id)).some(s => s.label.toLowerCase().includes(q))
        if (!match) return false
      }
      return true
    })
  }, [phaseFilter, tierFilter, subjectFilter, search])

  const handleSubjectClick = (s: Subject) => {
    setSubjectFilter(prev => (prev === s ? null : s))
    setView('subject')
  }

  const activeFilterCount = [phaseFilter, tierFilter, subjectFilter, search].filter(Boolean).length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Reference Projects</h1>
        <p className="text-gray-400 text-sm">
          {projects.length} open-source projects across {subjects.length} subject areas
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* View toggle */}
        <div className="flex bg-gray-900 rounded-lg border border-gray-800 p-0.5">
          <button
            onClick={() => setView('subject')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              view === 'subject' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            By Subject
          </button>
          <button
            onClick={() => setView('project')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              view === 'project' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            By Project
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search projects..."
          className="text-sm bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 w-48"
        />

        {/* Phase filters */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Phase:</span>
          {[1, 2, 3, 4, 5].map(p => (
            <button
              key={p}
              onClick={() => setPhaseFilter(prev => (prev === p ? null : p))}
              className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                phaseFilter === p
                  ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-800'
                  : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Tier filters */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Tier:</span>
          {[1, 2, 3].map(t => (
            <button
              key={t}
              onClick={() => setTierFilter(prev => (prev === t ? null : t))}
              className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                tierFilter === t
                  ? 'bg-blue-900/50 text-blue-300 border border-blue-800'
                  : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <button
            onClick={() => {
              setPhaseFilter(null)
              setTierFilter(null)
              setSubjectFilter(null)
              setSearch('')
            }}
            className="text-xs text-gray-500 hover:text-white transition-colors cursor-pointer"
          >
            Clear all ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Subject filter pill (shown when active) */}
      {subjectFilter && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-gray-500">Filtered to:</span>
          <button
            onClick={() => setSubjectFilter(null)}
            className="text-xs px-2 py-1 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-800/50 hover:bg-emerald-900/50 transition-colors cursor-pointer"
          >
            {subjects.find(s => s.id === subjectFilter)?.label} x
          </button>
        </div>
      )}

      {/* Phase-Subject Matrix */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-8">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Coverage Matrix</h2>
        <p className="text-xs text-gray-500 mb-4">
          Dot size shows how many reference projects cover each subject-phase intersection
        </p>
        <SubjectGraph />
      </div>

      {/* Results count */}
      <div className="text-xs text-gray-500 mb-4">
        Showing {filteredProjects.length} of {projects.length} projects
      </div>

      {/* View A: By Subject */}
      {view === 'subject' && (
        <div className="space-y-6">
          {subjects
            .filter(s => !subjectFilter || s.id === subjectFilter)
            .map(subject => {
              const subjectProjects = filteredProjects.filter(p =>
                p.subjects.includes(subject.id)
              )
              if (subjectProjects.length === 0) return null
              return (
                <div key={subject.id}>
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-lg font-semibold text-white">{subject.label}</h3>
                    <span className="text-xs text-gray-500">{subject.description}</span>
                    <div className="flex gap-1 ml-auto">
                      {subject.phases.map(p => (
                        <PhaseBadge key={p} phase={p} />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {subjectProjects.map(p => (
                      <ProjectCard key={p.name} project={p} onSubjectClick={handleSubjectClick} />
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {/* View B: By Project (grouped by tier) */}
      {view === 'project' && (
        <div className="space-y-8">
          {[1, 2, 3].map(tier => {
            const tierProjects = filteredProjects.filter(p => p.tier === tier)
            if (tierProjects.length === 0) return null
            return (
              <div key={tier}>
                <h3 className="text-lg font-semibold text-white mb-1">
                  Tier {tier}: {tierLabels[tier]}
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  {tier === 1 && 'Install and use directly in GROUNDLINK'}
                  {tier === 2 && 'Study architecture and adapt patterns'}
                  {tier === 3 && 'Supplementary learning and cross-validation'}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {tierProjects.map(p => (
                    <ProjectCard key={p.name} project={p} onSubjectClick={handleSubjectClick} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
