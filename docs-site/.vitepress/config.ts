import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Driftless',
  description: 'Living docs for multi-repo teams — local or Cloudflare',
  appearance: false, // light mode only
  head: [['link', { rel: 'icon', href: '/logo.svg' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Tutorial', link: '/guide/tutorial' },
      { text: 'App', link: 'https://driftless.sahinur.dev' },
      { text: 'GitHub', link: 'https://github.com/SahinurDEV/driftless' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Local mode', link: '/guide/local-mode' },
          { text: 'Cloudflare deploy', link: '/guide/cloud-deploy' },
          { text: 'MCP', link: '/guide/mcp' },
          { text: 'Features', link: '/guide/features' },
          { text: 'Architecture', link: '/guide/architecture' },
          { text: 'Tutorial', link: '/guide/tutorial' },
        ],
      },
    ],
    footer: { message: 'MIT License', copyright: '© Sahinur' },
  },
})
