"use client";

import { RiCloudLine } from "@remixicon/react";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/ui";

function formatRelativeTime(iso: string): string {
	const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (diffSec < 60) return "agora mesmo";
	if (diffSec < 3600) {
		const min = Math.floor(diffSec / 60);
		return `há ${min} min`;
	}
	if (diffSec < 86400) {
		const h = Math.floor(diffSec / 3600);
		return `há ${h}h`;
	}
	const d = Math.floor(diffSec / 86400);
	return `há ${d} dia${d > 1 ? "s" : ""}`;
}

export function BackupButton() {
	const [lastBackup, setLastBackup] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);
	const [displayTime, setDisplayTime] = useState("—");

	// Busca o timestamp ao montar
	useEffect(() => {
		fetch("/api/backup")
			.then((r) => r.json())
			.then((d: { lastBackup: string | null }) => {
				if (d.lastBackup) setLastBackup(d.lastBackup);
			})
			.catch(() => {});
	}, []);

	// Atualiza o texto relativo a cada minuto
	useEffect(() => {
		if (!lastBackup) {
			setDisplayTime("nunca");
			return;
		}
		setDisplayTime(formatRelativeTime(lastBackup));
		const interval = setInterval(() => {
			setDisplayTime(formatRelativeTime(lastBackup));
		}, 60_000);
		return () => clearInterval(interval);
	}, [lastBackup]);

	const handleBackup = async () => {
		if (isPending) return;
		setIsPending(true);
		try {
			const res = await fetch("/api/backup", { method: "POST" });
			const data = (await res.json()) as { lastBackup?: string; error?: string };
			if (data.lastBackup) setLastBackup(data.lastBackup);
		} finally {
			setIsPending(false);
		}
	};

	return (
		<div className="flex items-center gap-1.5">
			<span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
				{isPending ? "fazendo backup..." : displayTime}
			</span>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={handleBackup}
						disabled={isPending}
						aria-label="Fazer backup na nuvem"
						className={cn(
							buttonVariants({ variant: "ghost", size: "icon-sm" }),
							"size-8 text-muted-foreground transition-all duration-200",
							"hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 border",
							"disabled:pointer-events-none disabled:opacity-50",
						)}
					>
						<RiCloudLine
							className={cn(
								"size-4 transition-all duration-200",
								isPending && "animate-pulse",
							)}
							aria-hidden
						/>
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{isPending ? "Fazendo backup..." : "Fazer backup na nuvem"}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
