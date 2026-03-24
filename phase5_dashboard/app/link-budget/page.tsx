import LinkBudgetCalculator from '@/components/LinkBudgetCalculator'

export default function LinkBudgetPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Interactive Link Budget Calculator</h1>
      <p className="text-gray-400 mb-6">
        Adjust parameters to compute a real-time space-to-ground link budget.
        All math runs client-side — ported from the Phase 1 Python engine.
      </p>
      <LinkBudgetCalculator />
    </div>
  )
}
