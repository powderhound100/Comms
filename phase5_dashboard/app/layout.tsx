import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'GROUNDLINK Dashboard',
  description: 'LEO Satellite Communications — Test & Validation Platform',
}

const navLinks = [
  { href: '/', label: 'Overview' },
  { href: '/link-budget', label: 'Link Budget' },
  { href: '/modem', label: 'Modem' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/passes', label: 'Passes' },
  { href: '/icd', label: 'ICD' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <nav className="bg-gray-900 border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-8">
            <Link href="/" className="text-xl font-bold text-emerald-400">
              GROUNDLINK
            </Link>
            <div className="flex gap-4">
              {navLinks.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
