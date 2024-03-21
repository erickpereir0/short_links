import fastify from "fastify";
import { z } from "zod";
import { sql } from "./lib/postgres";
import postgres from "postgres";
import { redis } from "./lib/redis";

const app = fastify();

app.get("/:code", async (request, reply) => {
    const getLinkSchema = z.object({
        code: z.string().min(3),
    });
    const { code } = getLinkSchema.parse(request.params);

    const result = await sql`SELECT id,original_url FROM short_links WHERE short_links.code = ${code}`;

    if (result.length === 0) {
        return reply.status(404).send({ message: "Link Not found" });
    }

    const link = result[0];

    await redis.zIncrBy("metrics", 1, link.id.toString());

    return reply.redirect(301, link.original_url);
});

app.get("/api/links", async () => {
    const result = await sql`SELECT * FROM short_links ORDER BY created_at DESC`;
    return result;
});

app.post("/api/links", async (request, reply) => {

    try {
        const createLinkSchema = z.object({
            code: z.string().min(3),
            url: z.string().url()
        });

        const { code, url } = createLinkSchema.parse(request.body);

        const result = await sql`INSERT INTO short_links (code, original_url) VALUES (${code}, ${url}) RETURNING id`

        const link = result[0];
        return reply.status(201).send({ shortLinkId: link.id });
    } catch (error) {
        if (error instanceof postgres.PostgresError) {
            if (error.code === "23505") {
                return reply.status(400).send({ message: "Duplicated code" });
            }
        }

        console.error(error);

        return reply.status(500).send({ message: "Internal server error" });
    }
});

app.get("/api/metrics", async () => {
    const result = await redis.zRangeByScoreWithScores("metrics", 0, 50);

    const metrics = result.sort((a, b) => a.score - b.score).map((item) => {
        return {
            shortLinkId: item.value,
            clicks: item.score
        };
    });
    return result;
});

app.listen({ port: 3000 }).then(() => {
    console.log("server listening on http://localhost:3000");
});