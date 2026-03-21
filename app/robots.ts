import type { MetadataRoute } from "next";

const BASE_URL = process.env.PUBLIC_DOMAIN
	? `https://${process.env.PUBLIC_DOMAIN}`
	: "https://penny.com";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: [
					"/dashboard",
					"/lancamentos",
					"/contas",
					"/cartoes",
					"/categorias",
					"/orcamentos",
					"/pagadores",
					"/anotacoes",
					"/insights",
					"/calendario",
					"/consultor",
					"/ajustes",
					"/relatorios",
					"/pre-lancamentos",
					"/login",
					"/api/",
				],
			},
		],
		sitemap: `${BASE_URL}/sitemap.xml`,
	};
}
