"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { getNextPeriod, getPreviousPeriod } from "@/lib/utils/period";
import LoadingSpinner from "./loading-spinner";
import NavigationButton from "./nav-button";
import ReturnButton from "./return-button";
import { MONTH_PERIOD_PARAM, useMonthPeriod } from "./use-month-period";

export default function MonthNavigation() {
	const { period, currentMonth, currentYear, defaultPeriod, buildHref } =
		useMonthPeriod();

	const router = useRouter();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();

	// When no explicit period is in the URL, redirect to the client-computed default
	// period so the server component fetches data for the correct local month
	// (avoids UTC vs UTC-3 mismatch at midnight).
	useEffect(() => {
		if (!searchParams.get(MONTH_PERIOD_PARAM)) {
			router.replace(buildHref(defaultPeriod), { scroll: false });
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const currentMonthLabel = useMemo(
		() =>
			`${currentMonth.charAt(0).toUpperCase()}${currentMonth.slice(1)} ${currentYear}`,
		[currentMonth, currentYear],
	);
	const prevTarget = useMemo(
		() => buildHref(getPreviousPeriod(period)),
		[buildHref, period],
	);
	const nextTarget = useMemo(
		() => buildHref(getNextPeriod(period)),
		[buildHref, period],
	);
	const returnTarget = useMemo(
		() => buildHref(defaultPeriod),
		[buildHref, defaultPeriod],
	);
	const isDifferentFromCurrent = period !== defaultPeriod;

	// Prefetch otimizado: apenas meses adjacentes (M-1, M+1) e mês atual
	// Isso melhora a performance da navegação sem sobrecarregar o cliente
	useEffect(() => {
		// Prefetch do mês anterior e próximo para navegação instantânea
		router.prefetch(prevTarget);
		router.prefetch(nextTarget);

		// Prefetch do mês atual se não estivermos nele
		if (isDifferentFromCurrent) {
			router.prefetch(returnTarget);
		}
	}, [router, prevTarget, nextTarget, returnTarget, isDifferentFromCurrent]);

	const handleNavigate = (href: string) => {
		startTransition(() => {
			router.replace(href, { scroll: false });
		});
	};

	return (
		<Card className="flex w-full flex-row bg-card text-card-foreground p-4 sticky top-16 z-10">
			<div className="flex items-center gap-1">
				<NavigationButton
					direction="left"
					disabled={isPending}
					onClick={() => handleNavigate(prevTarget)}
				/>

				<div className="flex items-center">
					<div
						suppressHydrationWarning
						className="mx-1 space-x-1 capitalize font-semibold"
						aria-current={!isDifferentFromCurrent ? "date" : undefined}
						aria-label={`Período selecionado: ${currentMonthLabel}`}
					>
						<span suppressHydrationWarning>{currentMonthLabel}</span>
					</div>

					{isPending && <LoadingSpinner />}
				</div>

				<NavigationButton
					direction="right"
					disabled={isPending}
					onClick={() => handleNavigate(nextTarget)}
				/>
			</div>

			{isDifferentFromCurrent && (
				<ReturnButton
					disabled={isPending}
					onClick={() => handleNavigate(returnTarget)}
				/>
			)}
		</Card>
	);
}
