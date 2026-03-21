import type { Metadata } from "next";
import type { ReactNode } from "react";

const BASE_URL = process.env.PUBLIC_DOMAIN
	? `https://${process.env.PUBLIC_DOMAIN}`
	: "https://penny.com";

const TITLE = "Penny | Finanças pessoais self-hosted e open source";
const DESCRIPTION =
	"Aplicativo self-hosted de finanças pessoais. Controle lançamentos, cartões, orçamentos e categorias com total privacidade. Open source e gratuito.";

export const metadata: Metadata = {
	metadataBase: new URL(BASE_URL),
	title: TITLE,
	description: DESCRIPTION,
	keywords: [
		"finanças pessoais",
		"controle financeiro",
		"self-hosted",
		"open source",
		"gestão financeira",
		"orçamento pessoal",
		"lançamentos financeiros",
		"cartão de crédito",
		"planejamento financeiro",
	],
	alternates: {
		canonical: "/",
	},
	openGraph: {
		type: "website",
		locale: "pt_BR",
		url: "/",
		siteName: "Penny",
		title: TITLE,
		description: DESCRIPTION,
		images: [
			{
				url: "/dashboard-preview-light.webp",
				width: 1920,
				height: 1080,
				alt: "Penny — Dashboard de finanças pessoais",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: TITLE,
		description: DESCRIPTION,
		images: ["/dashboard-preview-light.webp"],
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
};

export default function LandingLayout({ children }: { children: ReactNode }) {
	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "Penny",
		applicationCategory: "FinanceApplication",
		operatingSystem: "Web",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "BRL",
		},
		description: DESCRIPTION,
		url: BASE_URL,
		isAccessibleForFree: true,
		author: {
			"@type": "Organization",
			name: "Penny",
			url: BASE_URL,
		},
	};

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
			{children}
		</>
	);
}
