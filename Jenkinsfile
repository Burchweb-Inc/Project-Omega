import jdk.internal.agent.resources.agent
pipeline {
    agent any;
    stages {
        stage('Build') {
            environment {
                TAG = "project-omega:latest"
            }
            steps {
                echo "Building ${TAG}"
                script {
                    docker.build(env.TAG)
                }
            }
        }
        stage('Deploy') {
            environment {
                OPENROUTER_API_KEY = credentials('341a4e99-85d0-48d2-94e8-db3b96bf7e12')
            }
            steps {
                // I am not proud of this, but for now just tear down and set up the container directly on the agent
                sh '''
                    docker compose -f "deploy/main/docker-compose.yml" up -d
                '''
            }
        }
    }
}
