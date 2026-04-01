"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
	formatPeriod,
	formatPeriodForUrl,
	formatPeriodParam,
	getCurrentPeriod,
	MONTH_NAMES,
	parsePeriodParam,
} from "@/lib/utils/period";

const PERIOD_PARAM = "periodo";

export function useMonthPeriod() {
	const searchParams = useSearchParams();
	const pathname = usePathname();
	const router = useRouter();

	const periodFromParams = searchParams.get(PERIOD_PARAM);
	const defaultPeriod = useMemo(() => getCurrentPeriod(), []);
	const referenceDate = useMemo(() => {
		const [y, m] = defaultPeriod.split("-").map(Number);
		return new Date(y, (m ?? 1) - 1, 1);
	}, [defaultPeriod]);
	const { period, monthName, year } = useMemo(
		() => parsePeriodParam(periodFromParams, referenceDate),
		[periodFromParams, referenceDate],
	);
	const defaultMonth = useMemo(
		() => MONTH_NAMES[referenceDate.getMonth()] ?? "",
		[referenceDate],
	);
	const defaultYear = useMemo(
		() => referenceDate.getFullYear().toString(),
		[referenceDate],
	);

	const buildHref = useCallback(
		(targetPeriod: string) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set(PERIOD_PARAM, formatPeriodForUrl(targetPeriod));

			return `${pathname}?${params.toString()}`;
		},
		[pathname, searchParams],
	);

	const buildHrefFromMonth = useCallback(
		(month: string, nextYear: string | number) => {
			const parsedYear = Number.parseInt(String(nextYear).trim(), 10);
			if (Number.isNaN(parsedYear)) {
				return buildHref(defaultPeriod);
			}

			const param = formatPeriodParam(month, parsedYear);
			const parsed = parsePeriodParam(param, referenceDate);
			return buildHref(parsed.period);
		},
		[buildHref, defaultPeriod, referenceDate],
	);

	const replacePeriod = useCallback(
		(targetPeriod: string) => {
			if (!targetPeriod) {
				return;
			}

			router.replace(buildHref(targetPeriod), { scroll: false });
		},
		[buildHref, router],
	);

	return {
		pathname,
		period,
		currentMonth: monthName,
		currentYear: year.toString(),
		defaultPeriod,
		defaultMonth,
		defaultYear,
		buildHref,
		buildHrefFromMonth,
		replacePeriod,
	};
}

export { PERIOD_PARAM as MONTH_PERIOD_PARAM };
