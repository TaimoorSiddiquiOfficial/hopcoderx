const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://hopcoder.dev" : `https://${stage}.hopcoder.dev`,
  console: stage === "production" ? "https://hopcoder.dev/auth" : `https://${stage}.hopcoder.dev/auth`,
  email: "contact@hopcoder.dev",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/TaimoorSiddiquiOfficial/hopcoderx",
  discord: "https://github.com/TaimoorSiddiquiOfficial/hopcoderx/discussions",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
