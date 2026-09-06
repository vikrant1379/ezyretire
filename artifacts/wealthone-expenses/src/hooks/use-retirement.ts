import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchFinancialData } from "@/lib/financial-api";
import { useFinancialWrite, FINANCIAL_DATA_KEY } from "@/hooks/use-financial-write";
import { type ProfileInputs, type RetirementInputs } from "@/lib/storage";

export function useRetirementInputs() {
  return useQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
    select: (data) => data.retirementInputs,
  });
}

export function useUpdateRetirementInputs() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (inputs: RetirementInputs) => {
      await write((current) => ({
        ...current,
        retirementInputs: inputs,
        profileInputs: {
          ...current.profileInputs,
          dateOfBirth: inputs.dateOfBirth,
          targetRetirementAge: inputs.targetRetirementAge,
          lifeExpectancy: inputs.lifeExpectancy,
        },
      }));
      return inputs;
    },
  });
}

export function useProfileInputs() {
  return useQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
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
