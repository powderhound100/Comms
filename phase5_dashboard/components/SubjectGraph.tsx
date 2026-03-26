'use client'

import { subjects, projects, phaseLabels } from '@/data/references'

const phaseColors = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
]

export default function SubjectGraph() {
  const phaseNums = [1, 2, 3, 4, 5]

  // Build matrix: for each subject x phase, count how many projects cover both
  const matrix = subjects.map(s => {
    return phaseNums.map(p => {
      return projects.filter(
        proj => proj.subjects.includes(s.id) && proj.phases.includes(p)
      ).length
    })
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 pr-4 text-gray-400 font-medium w-56">Subject</th>
            {phaseNums.map(p => (
              <th key={p} className="py-2 px-3 text-center text-gray-400 font-medium whitespace-nowrap">
                <div className="text-xs">Phase {p}</div>
                <div className="text-[10px] text-gray-500">{phaseLabels[p]}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subjects.map((s, si) => (
            <tr key={s.id} className="border-t border-gray-800/50">
              <td className="py-2 pr-4 text-gray-300">{s.label}</td>
              {matrix[si].map((count, pi) => (
                <td key={pi} className="py-2 px-3 text-center">
                  {count > 0 ? (
                    <div className="flex items-center justify-center">
                      <div
                        className={`rounded-full ${phaseColors[pi]} flex items-center justify-center`}
                        style={{
                          width: `${Math.min(12 + count * 6, 28)}px`,
                          height: `${Math.min(12 + count * 6, 28)}px`,
                          opacity: Math.min(0.5 + count * 0.2, 1),
                        }}
                      >
                        {count > 1 && (
                          <span className="text-[9px] font-bold text-white">{count}</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-800" />
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
