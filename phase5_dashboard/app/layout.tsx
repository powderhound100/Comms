import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'
import MobileNav from '@/components/MobileNav'

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
  { href: '/gnu-radio', label: 'GNU Radio' },
  { href: '/ground-station', label: 'Ground Station' },
  { href: '/signal-recognition', label: 'Signal Recognition' },
  { href: '/imagery', label: 'Imagery' },
  { href: '/signal-monitor', label: 'Signal Monitor' },
  { href: '/ads-b', label: 'ADS-B' },
  { href: '/references', label: 'References' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <nav className="bg-gray-900 border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="text-xl font-bold text-emerald-400 shrink-0">
              GROUNDLINK
            </Link>
            {/* Desktop nav */}
            <div className="hidden lg:flex gap-4 overflow-x-auto">
              {navLinks.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-gray-400 hover:text-white transition-colors whitespace-nowrap"
                >
                  {link.label}
                </Link>
              ))}
            </div>
            {/* Mobile nav */}
            <MobileNav links={navLinks} />
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
