const { app } = require('@azure/functions');
const { BlobServiceClient } = require("@azure/storage-blob");

app.http('DeletePostFunction', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // リクエストボディを取得
            const { threadId, postId } = await request.json();
            if (!threadId || !postId) {
                return {
                    status: 400,
                    jsonBody: { error: "スレッドIDと投稿IDは必須です。" }
                };
            }

            // Azure Storageに接続
            const connectionString = process.env.AzureWebJobsStorage;
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient("threads");
            const blobClient = containerClient.getBlobClient(`${threadId}.json`);

            // 現在のスレッドデータを取得
            let threadData;
            try {
                const downloadResponse = await blobClient.download();
                const content = await streamToBuffer(downloadResponse.readableStreamBody);
                threadData = JSON.parse(content.toString());
            } catch (error) {
                return {
                    status: 404,
                    jsonBody: { error: "指定されたスレッドが見つかりません。" }
                };
            }

            // 投稿を削除
            const postIndex = threadData.posts.findIndex(post => post.id === postId);
            if (postIndex === -1) {
                return {
                    status: 404,
                    jsonBody: { error: "指定された投稿が見つかりません。" }
                };
            }

            // 投稿を配列から削除
            threadData.posts.splice(postIndex, 1);

            // 更新したデータを保存
            const updatedData = JSON.stringify(threadData);
            await blobClient.upload(updatedData, updatedData.length, { overwrite: true });

            return {
                jsonBody: {
                    message: "投稿を削除しました",
                    threadId,
                    postId
                }
            };

        } catch (error) {
            context.log.error('Error in DeletePostFunction:', error);
            return {
                status: 500,
                jsonBody: { error: "投稿の削除中にエラーが発生しました。" }
            };
        }
    }
});

// ストリームをバッファに変換するユーティリティ関数
async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => {
            chunks.push(data instanceof Buffer ? data : Buffer.from(data));
        });
        readableStream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        readableStream.on("error", reject);
    });
}