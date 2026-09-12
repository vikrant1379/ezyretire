import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { financialDataQueryOptions } from "@/lib/query-policy";
import { useFinancialWrite } from "@/hooks/use-financial-write";
import { allocateGoalSurplus, goalStatus, inflatedGoalTarget, requiredGoalContribution } from "@/lib/goals";
import { calculateRetirementReadiness } from "@/lib/retirement-projection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Badge } from "@workspace/wealthone-design-system/components/ui/badge";
import { Target, AlertCircle, Plus, Edit2, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/wealthone-design-system/components/ui/alert";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { GoalFormDialog } from "@/components/goals/goal-form-dialog";
import { Progress } from "@workspace/wealthone-design-system/components/ui/progress";
import { parseDateOnly, type FinancialGoal } from "@/lib/storage";

export default function Goals() {
  const { data, isLoading } = useQuery(financialDataQueryOptions());
  const write = useFinancialWrite();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<FinancialGoal | undefined>(undefined);
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);
  
  if (isLoading || !data) return <div>Loading...</div>;

  const readiness = calculateRetirementReadiness({
    expenses: data.expenses,
    budgets: data.budgets,
    incomes: data.incomeSources,
    investments: data.investments,
    loans: data.loans,
    plannedExpenses: data.plannedExpenses,
    emergencyFund: data.emergencyFund,
    assumptions: data.retirementInputs,
  });

  const availableSurplus = Math.max(0, readiness.unallocatedSurplus);
  const requestedCommitment = data.goals.reduce(
    (sum, goal) => sum + Math.max(0, goal.monthlyAllocation),
    0,
  );
  
  const allocation = allocateGoalSurplus(data.goals, availableSurplus);
  
  const handleDelete = async (id: string) => {
    if (deletingGoalId) return;
    const goal = data.goals.find((item) => item.id === id);
    if (!goal || !window.confirm(`Delete “${goal.name}”? This removes its plan and cannot be undone.`)) {
      return;
    }
    setDeletingGoalId(id);
    try {
      await write((current) => ({
        ...current,
        goals: current.goals.filter(g => g.id !== id)
      }));
    } catch {
      // The shared write handler explains the failure and the unchanged goal remains retryable.
    } finally {
      setDeletingGoalId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
          <p className="text-muted-foreground">Prioritize and fund your financial goals</p>
        </div>
        <GoalFormDialog 
          isOpen={isAddOpen} 
          setIsOpen={setIsAddOpen}
          availableSurplus={availableSurplus}
          currentCommitted={requestedCommitment}
        >
          <Button onClick={() => { setEditingGoal(undefined); setIsAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Goal
          </Button>
        </GoalFormDialog>
      </div>

      <GoalFormDialog 
        goal={editingGoal}
        isOpen={!!editingGoal}
        setIsOpen={(open) => { if (!open) setEditingGoal(undefined); }}
        availableSurplus={availableSurplus}
        currentCommitted={requestedCommitment - (editingGoal?.monthlyAllocation || 0)}
      />

      {allocation.overAllocated && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Over-allocated</AlertTitle>
          <AlertDescription>
            You have committed {allocation.committed.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} to goals, but your confirmed monthly surplus is only {availableSurplus.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}. Lower priority goals will not be fully funded.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available Surplus</CardDescription>
            <CardTitle className={`text-2xl font-serif ${availableSurplus > 0 ? "text-warning" : availableSurplus < 0 ? "text-negative" : "text-foreground"}`}>{availableSurplus.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Committed to Goals</CardDescription>
            <CardTitle className="text-2xl font-serif">{allocation.committed.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unallocated Surplus</CardDescription>
            <CardTitle className={`text-2xl font-serif ${allocation.unallocated > 0 ? "text-warning" : allocation.unallocated < 0 ? "text-negative" : "text-foreground"}`}>{allocation.unallocated.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="space-y-4">
        {data.goals.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <Target className="h-12 w-12 mb-4 text-muted" />
            <p>No goals defined yet.</p>
            <Button variant="outline" className="mt-4" onClick={() => { setEditingGoal(undefined); setIsAddOpen(true); }}>Set your first goal</Button>
          </Card>
        ) : (
          data.goals.map(goal => {
            const allocInfo = allocation.allocations.find(a => a.goalId === goal.id);
            const status = goalStatus(goal, new Date());
            const inflatedTarget = inflatedGoalTarget(goal, new Date());
            const requiredMonth = requiredGoalContribution(goal, new Date());
            const progress = inflatedTarget > 0 ? Math.min(100, Math.round((goal.currentAmount / inflatedTarget) * 100)) : 0;
            
            return (
              <Card key={goal.id} className="overflow-hidden">
                <CardHeader className="bg-muted/30 pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">Priority {goal.priority}</Badge>
                        <Badge variant={status === 'completed' ? 'default' : status === 'behind' || status === 'overdue' ? 'destructive' : 'secondary'}>
                          {status}
                        </Badge>
                      </div>
                      <CardTitle className="text-xl">{goal.name}</CardTitle>
                      <CardDescription>Target date: {parseDateOnly(goal.targetDate).toLocaleDateString()}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditingGoal(goal)} aria-label={`Edit ${goal.name}`}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={Boolean(deletingGoalId)} onClick={() => handleDelete(goal.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10" aria-label={`Delete ${goal.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Target (Inflated)</p>
                      <p className="font-semibold">{inflatedTarget.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Saved So Far</p>
                      <p className="font-semibold">{goal.currentAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Req. Contribution</p>
                      <p className="font-semibold">{requiredMonth.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}/mo</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Allocation</p>
                      <p className="font-semibold">
                        <span className={allocInfo && allocInfo.shortfall > 0 ? "text-negative" : ""}>
                          {allocInfo?.allocated.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                        </span>
                        <span className="text-muted-foreground font-normal text-sm"> / {goal.monthlyAllocation.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} req</span>
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span>Progress</span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
