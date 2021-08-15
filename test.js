require("dotenv").config();

const { Client } = require("./src/")

const client = new Client(process.env.DISCORD_TOKEN, {
  intents: 13827,
  rest: { fetchAllUsers: true }
});

client.on("messageCreate", (data) => {
  if (data.content === "log") {
    client.rest.api
      .channels["857279585568686100"]
      .messages.post({ data: { content: "oi" }, authenticate: true })
  }
})

client.start();
