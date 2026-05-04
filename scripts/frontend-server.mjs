import { createServer } from 'vite'

const HOST = '127.0.0.1'
const PORT = 5173

async function main() {
  const server = await createServer({
    server: {
      host: HOST,
      port: PORT,
      strictPort: true,
    },
  })

  await server.listen()
  server.printUrls()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
