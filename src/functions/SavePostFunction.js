const { app } = require('@azure/functions');
const { BlobServiceClient } = require("@azure/storage-blob");

// スレッドの存在確認とリトライ処理
async function checkThreadExists(containerClient, blobName, maxRetries = 3, retryInterval = 3000, context) {
    for (let i = 0; i < maxRetries; i++) {
        context.log.debug(`Attempt ${i + 1}/${maxRetries} to find blob: ${blobName}`);

        // threads コンテナ内のすべての Blob をリスト
        for await (const blob of containerClient.listBlobsFlat()) {
            context.log.debug(`Found blob in threads container: ${blob.name}`);
        }

        const blobClient = containerClient.getBlobClient(blobName);
        if (await blobClient.exists()) {
            context.log.debug(`Blob found: ${blobName}`);
            return true;
        }
        context.log.debug(`Blob not found. Retrying... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
    return false;
}

app.http('SavePostFunction', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log.debug('Request method:', request.method);
            const postData = await request.json();
            context.log.debug('Request body:', postData);

            // バリデーション: 投稿内容の確認
            if (!postData.content) {
                context.log.error('Missing content in request');
                return {
                    status: 400,
                    jsonBody: { error: "投稿内容は必須です。" }
                };
            }

            // スレッドIDの取得
            const threadId = postData.threadId || postData.id;
            if (!threadId) {
                context.log.error('Missing threadId/id in request');
                return {
                    status: 400,
                    jsonBody: { error: "スレッドIDは必須です。" }
                };
            }

            // Azure Storage接続情報
            const connectionString = process.env.AzureWebJobsStorage;
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient("threads");
            const blobName = `${threadId}.json`;

            context.log.debug('Blob Service URL:', blobServiceClient.url);
            context.log.debug('Checking existence for Blob:', blobName);

            // スレッドの存在確認（リトライを含む）
            const exists = await checkThreadExists(containerClient, blobName, 3, 3000, context);
            if (!exists) {
                context.log.error({
                    message: 'Failed to save post - Thread not found',
                    operation: 'checkThreadExists',
                    details: {
                        threadId: threadId,
                        blobName: blobName,
                        containerName: containerClient.containerName,
                        retryAttempts: 3,
                        retryDelay: 3000,
                        timestamp: new Date().toISOString(),
                    }
                });

                return {
                    status: 404,
                    jsonBody: {
                        error: "スレッドが見つかりません。",
                        threadId: threadId
                    }
                };
            }

            // スレッドデータの取得
            const blobClient = containerClient.getBlobClient(blobName);
            const downloadResponse = await blobClient.download();
            const content = await streamToBuffer(downloadResponse.readableStreamBody);
            const threadData = JSON.parse(content.toString());
            context.log.debug('Retrieved thread data:', threadData);

            // 新規投稿データの準備
            const newPost = {
                id: postData.id || `post-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                content: postData.content,
                name: postData.name || 'Anonymous',
                timestamp: postData.timestamp || new Date().toISOString()
            };

            // 投稿をスレッドデータに追加
            threadData.posts = threadData.posts || [];
            threadData.posts.push(newPost);
            context.log.debug('Added new post to thread:', newPost);

            // 更新されたスレッドデータを保存
            const updatedData = JSON.stringify(threadData, null, 2);
            await blobClient.upload(updatedData, updatedData.length, { overwrite: true });
            context.log.debug('Successfully saved updated thread data');

            return {
                status: 200,
                jsonBody: {
                    message: "投稿を追加しました",
                    threadId: threadId,
                    postId: newPost.id
                }
            };
        } catch (error) {
            context.log.error('SavePostFunction encountered an error:', error.message);
            context.log.error('Stack trace:', error.stack);
            return {
                status: 500,
                jsonBody: { error: "投稿の保存中にエラーが発生しました。" }
            };
        }
    }
});

// POST以外のリクエストに対応
app.http('SavePostFunctionFallback', {
    methods: ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log.debug('Method Not Allowed');
        context.log.debug('Received method:', request.method);
        context.log.debug('Allowed methods:', ['POST']);
        return {
            status: 405,
            jsonBody: {
                message: "Method Not Allowed",
                allowedMethods: ['POST']
            }
        };
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