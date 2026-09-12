import { useQuery, useMutation } from "@tanstack/react-query";
import { useFinancialOperation, useFinancialWrite } from "@/hooks/use-financial-write";
import { updateRetirementPlanning } from "@/lib/financial-api";
import { financialDataQueryOptions } from "@/lib/query-policy";
import { type ProfileInputs, type RetirementInputs } from "@/lib/storage";
import { mergeRetirementScenarioInputs } from "@/lib/planning-simulations";

export function useRetirementInputs() {
  return useQuery({
    ...financialDataQueryOptions(),
    select: (data) => data.retirementInputs,
  });
}

export function useUpdateRetirementInputs() {
  const perform = useFinancialOperation();
  return useMutation({
    mutationFn: async (inputs: RetirementInputs) => {
      await perform(() => updateRetirementPlanning(inputs));
      return inputs;
    },
  });
}

export function useApplyRetirementScenario() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (scenario: RetirementInputs) => {
      const saved = await write((current) => ({
        ...current,
        retirementInputs: mergeRetirementScenarioInputs(current.retirementInputs, scenario),
        profileInputs: {
          ...current.profileInputs,
          targetRetirementAge: scenario.targetRetirementAge,
        },
      }));
      return saved.retirementInputs;
    },
  });
}

export function useProfileInputs() {
  return useQuery({
    ...financialDataQueryOptions(),
    select: (data) => data.profileInputs,
  });
}

export function useUpdateProfileInputs() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (inputs: ProfileInputs) => {
      await write((current) => ({
        ...current,
        profileInputs: inputs,
        retirementInputs: {
          ...current.retirementInputs,
          dateOfBirth: inputs.dateOfBirth,
          targetRetirementAge: inputs.targetRetirementAge,
          lifeExpectancy: inputs.lifeExpectancy,
        },
      }));
      return inputs;
    },
  });
}
